// Tela da Taverna: compartilhamento de tela direto entre navegadores (WebRTC), com o PeerJS cuidando de
// achar o outro lado (servidor público e gratuito do PeerJS, com retransmissão para redes mais fechadas).
//
// Links (gerados pelo /tela do bot):
//   ?compartilhar=<sala>&chave=<senha>  quem mostra a tela
//   ?assistir=<sala>&chave=<senha>      quem assiste
// Quem assiste abre uma conexão de dados com a chave; quem compartilha confere a chave e só então manda a tela.
// O TURN público do PeerJS não existe mais: o bot manda no link o TURN da Taverna (&turn=<host>&tu=<usuário>&tp=<senha>),
// com senha temporária, para quando os navegadores não conseguem se conectar direto (CGNAT, roteador fechado).

const params = new URLSearchParams(location.search);
const hostTurn = params.get('turn');
const OPCOES_PEER = /^[A-Za-z0-9.-]+$/.test(hostTurn ?? '')
	? {
			config: {
				iceServers: [
					{ urls: 'stun:stun.l.google.com:19302' },
					{ urls: [`turn:${hostTurn}:3478?transport=udp`, `turn:${hostTurn}:3478?transport=tcp`], username: params.get('tu'), credential: params.get('tp') },
				],
			},
		}
	: {};
const ESPERA_IMAGEM = 20_000; // achou a tela mas a imagem não chega: a rede bloqueou, tenta de novo
const PREFIXO = 'tavernatela-';
const MAX_BITRATE = 6_000_000; // 6 Mbps: texto nítido e vídeo fluido sem pesar demais para quem envia
const $ = (id) => document.getElementById(id);
const salaValida = (t) => /^[A-Za-z0-9]{6,40}$/.test(t ?? '');

const sala = params.get('compartilhar') ?? params.get('assistir');
const chave = params.get('chave') ?? '';
const modo = params.has('compartilhar') ? 'compartilhar' : params.has('assistir') ? 'assistir' : 'inicio';

function mostrar(id) {
	for (const s of ['inicio', 'compartilhar', 'assistir']) $(s).hidden = s !== id;
}

function selo(texto, aoVivo = false) {
	$('selo').hidden = !texto;
	$('selo').textContent = texto ?? '';
	$('selo').classList.toggle('ao-vivo', aoVivo);
}

if (modo === 'inicio' || !salaValida(sala) || !chave) {
	mostrar('inicio');
} else if (modo === 'compartilhar') {
	compartilhar();
} else {
	assistir();
}

// ---------- Quem compartilha ----------

function compartilhar() {
	mostrar('compartilhar');
	document.title = 'Compartilhando · Tela da Taverna';
	const status = (t) => ($('statusCompartilhar').textContent = t);
	const peer = new Peer(PREFIXO + sala, OPCOES_PEER);
	const plateia = new Map(); // id de quem assiste → { conn, chamada }
	let fluxo = null;

	const contar = () => ($('plateia').textContent = `👀 ${plateia.size} assistindo`);
	const avisarTodos = (msg) => plateia.forEach(({ conn }) => conn.open && conn.send(msg));

	peer.on('open', () => status(fluxo ? 'Ao vivo.' : 'Sala aberta. Escolha o que compartilhar.'));
	peer.on('disconnected', () => {
		status('Conexão com o servidor caiu, reconectando…');
		peer.reconnect();
	});
	peer.on('error', (e) => {
		if (e.type === 'unavailable-id') status('Esta sala já está aberta em outra aba. Feche a outra ou use /tela de novo.');
		else if (e.type !== 'peer-unavailable') status(`Problema na conexão (${e.type}). Tentando seguir…`);
	});

	peer.on('connection', (conn) => {
		conn.on('open', () => {
			if (conn.metadata?.chave !== chave) {
				conn.send({ tipo: 'negado' });
				setTimeout(() => conn.close(), 500);
				return;
			}
			plateia.get(conn.peer)?.chamada?.close();
			plateia.set(conn.peer, { conn });
			contar();
			if (fluxo) ligar(conn.peer);
			else conn.send({ tipo: 'esperando' });
		});
		conn.on('close', () => {
			plateia.get(conn.peer)?.chamada?.close();
			plateia.delete(conn.peer);
			contar();
		});
	});

	function ligar(id) {
		const p = plateia.get(id);
		if (!p || !fluxo) return;
		p.chamada?.close();
		p.chamada = peer.call(id, fluxo);
		melhorarQualidade(p.chamada);
	}

	/** Abre a escolha do navegador. preferirGuia já deixa aberta a aba "Guia do Chrome". */
	async function escolher(preferirGuia = false) {
		let novo;
		try {
			novo = params.has('demo')
				? fluxoDemo(params.get('demo') === 'tela')
				: await navigator.mediaDevices.getDisplayMedia({
						video: { frameRate: { ideal: 30, max: 60 }, ...(preferirGuia ? { displaySurface: 'browser' } : {}) },
						audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
						systemAudio: 'include',
						selfBrowserSurface: 'exclude',
					});
		} catch {
			status(fluxo ? 'Ao vivo.' : 'Nada foi escolhido. Clique de novo quando quiser.');
			return;
		}
		fluxo?.getTracks().forEach((t) => t.stop());
		fluxo = novo;
		const [video] = fluxo.getVideoTracks();
		video.addEventListener('ended', () => {
			if (fluxo === novo) parar();
		});
		$('previa').srcObject = fluxo;
		$('palcoVazio').hidden = true;
		$('trocar').hidden = false;
		$('parar').hidden = false;
		selo('AO VIVO', true);
		const semSom = fluxo.getAudioTracks().length === 0;
		status(semSom ? 'Ao vivo, sem som (marque "Compartilhar áudio" se quiser mandar o som).' : 'Ao vivo, com som.');
		// Tela inteira com som: vai junto todo o áudio do PC, inclusive o Discord (quem assiste se ouve).
		const telaInteira = params.get('demo') === 'tela' || video.getSettings().displaySurface === 'monitor';
		$('avisoEco').hidden = !(telaInteira && !semSom);
		plateia.forEach((_, id) => ligar(id));
	}

	/** Corta o som sem parar a imagem e manda de novo para quem assiste. */
	function tirarSom() {
		if (!fluxo) return;
		for (const t of fluxo.getAudioTracks()) {
			t.stop();
			fluxo.removeTrack(t);
		}
		$('avisoEco').hidden = true;
		status('Ao vivo, sem som (o Discord não vaza mais).');
		plateia.forEach((_, id) => ligar(id));
	}

	function parar() {
		fluxo?.getTracks().forEach((t) => t.stop());
		fluxo = null;
		plateia.forEach((p) => p.chamada?.close());
		avisarTodos({ tipo: 'parou' });
		$('previa').srcObject = null;
		$('palcoVazio').hidden = false;
		$('trocar').hidden = true;
		$('parar').hidden = true;
		$('avisoEco').hidden = true;
		selo('');
		status('Você parou de compartilhar. Dá para começar de novo.');
	}

	$('escolher').onclick = () => escolher();
	$('trocar').onclick = () => escolher();
	$('tirarSom').onclick = tirarSom;
	$('trocarGuia').onclick = () => escolher(true);
	$('deixarAssim').onclick = () => ($('avisoEco').hidden = true);
	$('parar').onclick = parar;
	window.addEventListener('beforeunload', () => avisarTodos({ tipo: 'parou' }));
}

/** Limita a taxa de envio e prefere manter a nitidez (texto, mapa) quando a internet aperta. */
function melhorarQualidade(chamada) {
	const aplicar = () => {
		const pc = chamada.peerConnection;
		if (!pc) return setTimeout(aplicar, 300);
		for (const sender of pc.getSenders()) {
			if (sender.track?.kind !== 'video') continue;
			const p = sender.getParameters();
			if (!p.encodings?.length) p.encodings = [{}];
			p.encodings[0].maxBitrate = MAX_BITRATE;
			p.degradationPreference = 'balanced';
			sender.setParameters(p).catch(() => {});
		}
	};
	chamada.on('stream', aplicar);
	setTimeout(aplicar, 1000);
}

/** Tela de teste (?demo): uma animação no lugar da tela, para testar sem escolher nada.
 *  ?demo=tela finge a tela inteira com som (um som mudo), para ver o aviso do Discord. */
function fluxoDemo(comSom = false) {
	const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
	const g = c.getContext('2d');
	let t = 0;
	setInterval(() => {
		t++;
		g.fillStyle = '#20170f';
		g.fillRect(0, 0, c.width, c.height);
		g.fillStyle = '#f0a83a';
		g.beginPath();
		g.arc(640 + Math.sin(t / 20) * 400, 360, 60, 0, Math.PI * 2);
		g.fill();
		g.font = '48px sans-serif';
		g.fillText(`Teste da Tela da Taverna · ${t}`, 60, 90);
	}, 33);
	const fluxo = c.captureStream(30);
	if (comSom) {
		const ctx = new AudioContext();
		const destino = ctx.createMediaStreamDestination();
		const volume = ctx.createGain();
		volume.gain.value = 0;
		const osc = ctx.createOscillator();
		osc.connect(volume).connect(destino);
		osc.start();
		fluxo.addTrack(destino.stream.getAudioTracks()[0]);
	}
	return fluxo;
}

// ---------- Quem assiste ----------

function assistir() {
	mostrar('assistir');
	document.title = 'Assistindo · Tela da Taverna';
	const status = (t) => ($('statusAssistir').textContent = t);
	const espera = (titulo, texto) => {
		$('espera').hidden = false;
		$('esperaTitulo').textContent = titulo;
		$('esperaTexto').textContent = texto;
	};
	const video = $('tela');
	const peer = new Peer(OPCOES_PEER);
	let conn = null;
	let negado = false;
	let retentativa = null;

	function tentarDeNovo(ms = 4000) {
		if (negado || retentativa) return;
		retentativa = setTimeout(() => {
			retentativa = null;
			conectar();
		}, ms);
	}

	function conectar() {
		if (peer.disconnected || peer.destroyed) return;
		conn?.close();
		conn = peer.connect(PREFIXO + sala, { metadata: { chave }, reliable: true });
		let abriu = false;
		conn.on('open', () => {
			abriu = true;
			status('Conectado à sala.');
		});
		conn.on('data', (d) => {
			if (d?.tipo === 'negado') {
				negado = true;
				espera('Link inválido', 'A senha desta sala não confere. Peça o link de novo no Discord.');
				status('Acesso negado.');
			} else if (d?.tipo === 'esperando') {
				espera('A tela ainda não começou', 'Quem abriu a sala ainda não escolheu o que mostrar. Fica aqui que aparece sozinho.');
			} else if (d?.tipo === 'parou') {
				chamadaAtual = null;
				video.srcObject = null;
				$('ativarSom').hidden = true;
				selo('');
				espera('A tela foi encerrada', 'Se começar de novo, aparece aqui sozinho.');
				status('Esperando…');
			}
		});
		conn.on('close', () => tentarDeNovo());
		setTimeout(() => {
			if (!abriu) tentarDeNovo(0);
		}, 8000);
	}

	peer.on('open', conectar);
	peer.on('disconnected', () => peer.reconnect());
	peer.on('error', (e) => {
		if (e.type === 'peer-unavailable') {
			espera('A sala ainda não abriu', 'Quem vai compartilhar ainda não abriu o link. Tentando de novo a cada poucos segundos…');
			status('Procurando a sala…');
			tentarDeNovo();
		} else {
			status(`Problema na conexão (${e.type}). Tentando de novo…`);
			tentarDeNovo();
		}
	});

	let chamadaAtual = null;
	peer.on('call', (chamada) => {
		chamadaAtual?.close();
		chamadaAtual = chamada;
		chamada.answer();
		let temImagem = false;

		// A chamada chega antes da imagem: só é "ao vivo" quando o primeiro quadro aparece.
		// Se a rede bloquear (o caminho não abre), avisa em vez de deixar a tela preta e pede a tela de novo.
		const semImagem = () => {
			if (temImagem || chamadaAtual !== chamada) return;
			chamadaAtual = null;
			chamada.close();
			video.srcObject = null;
			selo('');
			$('ativarSom').hidden = true;
			espera('Não deu para conectar a imagem', 'A rede de um dos dois bloqueou a tela. Tentando de novo…');
			status('Sem imagem. Tentando de novo…');
			conn?.close(); // ao reconectar, quem compartilha manda a tela de novo
		};
		const prazo = setTimeout(semImagem, ESPERA_IMAGEM);
		chamada.peerConnection?.addEventListener('iceconnectionstatechange', () => {
			if (chamada.peerConnection.iceConnectionState === 'failed') semImagem();
		});

		chamada.on('stream', (fluxo) => {
			if (video.srcObject === fluxo) return; // o PeerJS avisa uma vez por faixa (vídeo e som)
			video.srcObject = fluxo;
			selo('');
			espera('Conectando a imagem…', 'A tela foi encontrada, falta a imagem chegar.');
			status('Conectando a imagem…');
			const temSom = fluxo.getAudioTracks().length > 0;
			video.addEventListener(
				'loadeddata',
				() => {
					if (chamadaAtual !== chamada) return;
					temImagem = true;
					clearTimeout(prazo);
					$('espera').hidden = true;
					selo('AO VIVO', true);
					status(temSom ? 'Ao vivo, com som.' : 'Ao vivo (sem som desta vez).');
				},
				{ once: true },
			);
			$('ativarSom').hidden = true;
			video.muted = false;
			video.play().catch(() => {
				// O navegador só deixa tocar com som depois de um clique.
				video.muted = true;
				video.play().catch(() => {});
				$('ativarSom').hidden = !temSom;
			});
		});
	});

	$('ativarSom').onclick = () => {
		video.muted = false;
		video.play().catch(() => {});
		$('ativarSom').hidden = true;
	};
	$('volume').oninput = (e) => {
		video.volume = Number(e.target.value);
		if (video.muted && video.volume > 0) $('ativarSom').click();
	};
	$('telaCheia').onclick = () => {
		const palco = $('palcoAssistir');
		if (document.fullscreenElement) document.exitFullscreen();
		else palco.requestFullscreen?.().catch(() => {});
	};
}
