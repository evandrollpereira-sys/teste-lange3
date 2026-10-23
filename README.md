# Testador GraphQL do Fort Atacadista — Cloudflare Pages

## Arquivos
- `index.html`: interface de teste.
- `functions/api/graphql.js`: função do Cloudflare Pages que encaminha as consultas para `https://api.fortatacadista.com.br/storefront/graphql`.

## Publicar no Cloudflare Pages
1. Extraia o ZIP.
2. Envie os arquivos para um repositório GitHub, mantendo a estrutura de pastas.
3. No Cloudflare, entre em **Workers & Pages → Create → Pages → Connect to Git** e selecione o repositório.
4. Configure:
   - **Framework preset:** None
   - **Build command:** deixe vazio
   - **Build output directory:** `.`
5. Salve e aguarde o deploy.
6. Abra o endereço `*.pages.dev` gerado e clique em **Testar endpoint / introspecção**.

Se estiver usando upload direto de arquivos estáticos, prefira a integração com Git para este teste: a função em `functions/api/graphql.js` precisa ser implantada como Pages Function; não basta publicar somente o `index.html`.

## Como usar
- O botão de introspecção tenta consultar parte do esquema GraphQL. O servidor pode bloquear introspecção.
- A consulta inicial `query { __typename }` é apenas um teste básico, não uma consulta de preço.
- Para consultar preços, é necessário descobrir a query e as variáveis que o site oficial realmente usa. No site do Fort, abra as ferramentas de desenvolvedor do navegador, vá a **Network → Fetch/XHR**, pesquise um produto e examine a requisição para `storefront/graphql`. Copie o campo `query` e as `variables` para o app.
- O campo “Produto” só substitui o marcador literal `__PRODUTO__` na consulta. Ele não descobre automaticamente o nome do campo de pesquisa.

## Limitações
- O endpoint pode exigir cabeçalhos, cookies, sessão, loja/cidade selecionada ou outros parâmetros que não são encaminhados por este exemplo.
- A resposta do endpoint é exibida para diagnóstico. O app não garante que o preço será retornado até que a consulta correta e o contexto exigido sejam conhecidos.
