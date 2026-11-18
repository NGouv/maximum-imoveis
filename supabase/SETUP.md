# Configuração do Supabase

## 1. Aplicar o banco e as políticas

1. Abra o projeto Maximum no [dashboard do Supabase](https://supabase.com/dashboard/project/lwfegiadawykvbhuulgk).
2. No menu lateral, acesse **SQL Editor** e selecione **New query**.
3. Abra `supabase/schema.sql` neste projeto, copie o arquivo completo para a consulta e clique em **Run**.
4. Confirme que a execução terminou sem erros antes de iniciar o site.

O script cria as três tabelas, índices, triggers, políticas RLS e o bucket privado `imoveis`. Ele não cria imóveis de demonstração. O cadastro exige pelo menos um quarto e limita a entrega a até 36 meses, evitando studios e empreendimentos com previsão de três ou quatro anos. Os dados iniciais de contato são os que já estavam publicados no site e podem ser alterados em **Administração > Configurações**.

## 2. Conferir o Storage

No Supabase, acesse **Storage > Buckets > imoveis**. O bucket deve estar como **Private**. O SQL configura limite de 10 MiB e os tipos JPG, PNG, WebP e AVIF, além das políticas de leitura vinculada a imóveis publicados e escrita/exclusão exclusiva de administradores.

Não habilite **Public bucket** nem crie políticas adicionais que permitam upload público. As colunas `imagem_capa` e `imagens_imoveis.url` guardam a URL autenticada do objeto; o site baixa a imagem pela API do Storage, sujeita à RLS.

## 3. Desabilitar cadastro público e criar o primeiro administrador

1. Acesse **Authentication > Settings** e desligue **Allow new users to sign up**. A autenticação do painel é somente por login; usuários são criados pelo operador no dashboard.
2. Em **Authentication > Users**, clique em **Add user** e crie ou convide a conta do administrador.
3. No **SQL Editor**, primeiro confirme o endereço e o usuário correto:

   ```sql
   select id, email, raw_app_meta_data
   from auth.users
   where lower(email) = lower('admin@maximum.com.br');
   ```

4. Depois de confirmar que a consulta retornou exatamente a conta desejada, atribua a autorização administrativa:

   ```sql
   update auth.users
   set raw_app_meta_data =
     coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where lower(email) = lower('admin@maximum.com.br');
   ```

   Substitua o endereço de exemplo pelo e-mail criado e confira que uma linha foi atualizada. A autorização fica em `app_metadata`, que o usuário não pode alterar pelo cliente público. Não use `user_metadata` para conceder acesso.
5. Faça login em `/admin/login.html`. Se a sessão já estava aberta quando o papel foi atribuído, saia e entre novamente para renovar o token.

Para remover a autorização de uma conta, execute no SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'role'
where lower(email) = lower('admin@maximum.com.br');
```

## 4. Configurar o projeto local

O arquivo `.env.local` usa a URL e a publishable key fornecidas para este projeto. Ele é ignorado pelo Git. `.env.example` contém apenas nomes de variáveis, sem valores reais.

Se preparar outra instalação, copie `.env.example` para `.env.local` e preencha os valores em **Project Settings > API**:

```dotenv
VITE_SUPABASE_URL=https://lwfegiadawykvbhuulgk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key-do-projeto>
```

Use `VITE_SUPABASE_PUBLISHABLE_KEY` como nome recomendado. `VITE_SUPABASE_ANON_KEY` também é aceito para compatibilidade com instalações existentes. Use somente uma chave pública (publishable ou anon) no frontend. Nunca use `service_role`, senha de banco ou secret key em variáveis `VITE_*`.

## 5. Executar e compilar

No terminal, a partir da pasta do projeto:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

O login fica em `/admin/login.html`. O dashboard, imóveis e configurações verificam a sessão e a claim administrativa; as permissões finais são aplicadas no banco e no Storage, não apenas no navegador.
