# 🍺 Tela da Taverna

Compartilhamento de tela do servidor Taverna (Discord), usado pelo comando `/tela` do bot [taverna-bot](https://github.com/Gabs-X/taverna-bot).

Página: https://gabs-x.github.io/taverna-tela/

## Como funciona

- A tela vai **direto entre os navegadores** (WebRTC, com criptografia). Nada passa por servidor nosso.
- O [PeerJS](https://peerjs.com/) (licença MIT) faz o "aperto de mão" entre quem compartilha e quem assiste, pelo servidor público e gratuito dele, que também retransmite quando a rede é muito fechada.
- Links gerados pelo `/tela`:
  - `?compartilhar=<sala>&chave=<senha>`: quem mostra a tela.
  - `?assistir=<sala>&chave=<senha>`: quem assiste. Quem compartilha confere a senha antes de mandar a tela.
- A tela vai sempre com o som (o navegador pergunta; para vídeo do YouTube, escolha a guia do Chrome e marque "Compartilhar áudio").
- Cada pessoa assistindo recebe uma cópia direto de quem compartilha: vai bem com uns 4 a 6 assistindo.
- Tela inteira com som: o navegador manda todo o som do PC, inclusive o Discord (quem assiste se ouve). A página avisa e oferece "Tirar o som" ou "Trocar por uma guia".
- `&demo` no link de compartilhar manda uma animação de teste no lugar da tela; `&demo=tela` finge a tela inteira com som, para ver o aviso.

## Arquivos

- `index.html`: as três telas (início, compartilhar, assistir).
- `estilo.css`: o visual da Taverna.
- `app.js`: a conexão e os controles.
- `media/`: ícones.
