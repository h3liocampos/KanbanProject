# FlowBoard — versão com autenticação e Render

Aplicação Kanban com frontend HTML/CSS/JavaScript, backend Node.js + Express e banco PostgreSQL.

## Funcionalidades

- Cadastro e login com e-mail ou nome de usuário.
- Mostrar/ocultar senha e validação de campos.
- Senhas armazenadas com hash bcrypt (não são salvas em texto puro).
- Sessões persistidas no PostgreSQL, cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Limite de tentativas de login/cadastro.
- Logout.
- Quadro Kanban com criação, exclusão e movimentação de tarefas.
- Cada usuário acessa somente as próprias tarefas.
- Interface responsiva e arquivos HTML, CSS e JS separados.

## Executar localmente

Requisitos: Node.js 20+ e PostgreSQL.

1. Crie um banco PostgreSQL chamado `flowboard`.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` e `SESSION_SECRET`.
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Inicie:

   ```bash
   npm start
   ```

5. Abra `http://localhost:10000`.

O servidor cria as tabelas `users` e `tasks` ao iniciar. A tabela de sessões é criada pelo adaptador `connect-pg-simple`.

## Publicar no Render

O arquivo `render.yaml` descreve um Web Service Node e um banco PostgreSQL.

1. Envie a pasta do projeto para um repositório GitHub.
2. Entre no Render e selecione **New → Blueprint**.
3. Conecte o repositório que contém o `render.yaml`.
4. Revise os recursos e confirme a criação.
5. O Render provisionará o serviço e o banco, criará `SESSION_SECRET` e conectará `DATABASE_URL`.
6. Quando o deploy terminar, abra o domínio `*.onrender.com` fornecido pelo Render e crie sua conta na tela inicial.

O serviço escuta em `0.0.0.0` e usa a porta definida pelo Render. A aplicação deve ser publicada como **Web Service**, não como Static Site, pois precisa executar o backend.

## Segurança e observações

- Nunca envie `.env` ao GitHub.
- Não existe usuário/senha padrão no projeto: crie sua conta pela tela de cadastro.
- A senha é transformada em hash bcrypt com custo 12 antes de ser armazenada.
- O login retorna mensagem genérica para credenciais inválidas.
- As tarefas são isoladas por `user_id` no servidor; não dependem do `localStorage`.
- Em produção, o cookie de sessão exige HTTPS (`Secure`).
- O Render pode suspender instâncias gratuitas após inatividade e os planos/limites de banco gratuito podem mudar. Consulte os limites atuais antes de usar em produção.
- Para um produto público com dados importantes, configure backups, monitoramento e política de privacidade.

## Estrutura

```text
flowboard-render/
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server.js
├── package.json
├── render.yaml
├── .env.example
└── .gitignore
```
