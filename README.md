# Casa Cobre

Site conceito de um restaurante fictício de frutos do mar. A mesa é uma cena 3D em tempo real (three.js r186): quatro pratos modelados e iluminados no Blender, com caldo que balança e ferve, panela que inclina pela alça, camarões e empanados que dá para pegar e arrastar, batata palha que pula e câmera com foco de cinema.

## Rodar no computador

É um site estático. Sirva a pasta com qualquer servidor local e abra `index.html`:

```
npx serve .
```

## Qualidade

O site escolhe sozinho o nível pela placa de vídeo e baixa o nível se o aparelho engasgar. Para forçar: `?qualidade=alta`, `?qualidade=media` ou `?qualidade=baixa`.

- Alta: tudo ligado, foco de cinema, texturas 4K.
- Média: sem foco de cinema, 65% dos grãos.
- Baixa: metade dos grãos e da palha, sombras mais simples.

No celular, as texturas usam a versão `-m` (menor).
