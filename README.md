# ServiçoApp — Gestão de Equipes de Campo (B2B)

Plataforma de licenciamento por empresa: cada empresa compra uma licença
limitada a um número de colaboradores, cadastra os serviços que oferece,
designa cada atendimento a um colaborador (com endereço, horário e duração),
e acompanha tudo — de qualquer navegador ou como app instalado no celular
(PWA).

Esta é uma reconstrução completa do projeto anterior (marketplace de
diaristas entre duas pessoas físicas). O modelo de negócio, os papéis, as
telas e o banco de dados são novos. Nada do fluxo antigo (agendamento por
área/cômodos, chat, carteira, avaliações) foi mantido — não fazia sentido
no modelo B2B.

## Como rodar

```bash
npm install
npm run dev
```

Antes, copie `.env.example` para `.env` e preencha com os dados do seu
projeto Supabase (de preferência um projeto de **teste**, separado do de
produção). O `.env` não vai para o git. Abre em `http://localhost:5173`.

Testes de permissão do banco (precisa de um Postgres local):

```bash
supabase/tests/run.sh
```

```bash
npm run build     # build de produção em dist/ (já inclui o service worker do PWA)
npm run preview   # serve o build de produção localmente
npm run lint       # roda o ESLint
```

## 1. Configurar o banco (Supabase) — obrigatório antes de usar

Rode **`supabase-b2b-schema.sql`** inteiro no SQL Editor do Supabase. Ele
cria: `companies`, `services`, `assignments`, `api_keys`,
`crm_integrations`, estende `profiles` com `company_id` / `company_role` /
`is_platform_admin`, e configura todas as políticas de RLS (cada empresa só
enxerga os próprios dados; o admin da plataforma enxerga tudo).

Depois, torne seu próprio usuário admin da plataforma (troque o e-mail):

```sql
update public.profiles set is_platform_admin = true where email = 'seu-email-aqui@exemplo.com';
```

E crie a primeira empresa de teste, ou faça isso pela própria tela
`/plataforma` depois de logado como admin da plataforma:

```sql
insert into public.companies (name, license_key, collaborator_invite_code, seats_limit)
values ('Empresa Teste', 'LICENCA-TESTE-0001', 'CONVITE-TESTE-0001', 10);
```

## 2. Como testar o fluxo inteiro

1. Crie uma conta em `/login` → "Criar conta".
2. Rode o `update ... is_platform_admin = true` acima pro seu e-mail.
3. Entre de novo (ou recarregue) → você cai em `/plataforma`. Crie uma
   empresa por lá (gera chave de licença + código de convite sozinho).
4. Crie uma **segunda** conta (outro e-mail) — essa vai ser a empresa
   cliente. Na tela de ativação, escolha "Empresa nova" e cole a chave de
   licença. Você vira admin daquela empresa, caindo em `/painel`.
5. Em `/painel` → Serviços, cadastre um serviço. Em Colaboradores, copie o
   código de convite.
6. Crie uma **terceira** conta — essa vai ser o colaborador. Na ativação,
   escolha "Sou colaborador" e cole o código de convite. Cai em `/tarefas`
   (ainda vazio).
7. Volte pra conta de admin da empresa (`/painel` → Designações → Nova
   designação), escolha o serviço e o colaborador, um endereço (dá pra usar
   o GPS do navegador) e um horário.
8. Entre com a conta do colaborador e abra `/tarefas` — a designação aparece
   lá, com mapa até o endereço, horário e duração. Dá pra iniciar e concluir
   o atendimento.

## 3. Papéis

| Papel | Como se torna | O que vê |
|---|---|---|
| **Admin da plataforma** | `is_platform_admin = true` via SQL | `/plataforma` — cria/edita empresas, define limite de colaboradores, suspende, vê tudo de qualquer empresa |
| **Admin da empresa** | Resgata a **chave de licença** em `/ativar` | `/painel` — colaboradores, serviços, designações, mensagens, integrações/API, auditoria da própria empresa |
| **Supervisor** | Promovido por um admin da empresa (Painel → Colaboradores → editar → papel) | `/supervisao` — só os colaboradores atribuídos a ele (campo "supervisionado por"), designações e mensagens só desse grupo |
| **Colaborador** | Resgata o **código de convite** em `/ativar` (limitado ao nº de vagas) | `/tarefas` — só as designações atribuídas a ele |

## 4. API de saída (pra sistemas externos lerem seus dados)

Cada empresa gera suas próprias chaves em **Painel → Integrações & API**.
A leitura é feita por uma Edge Function que ainda precisa ser publicada uma
vez (fonte em `supabase/functions/api-data`):

```bash
supabase functions deploy api-data --no-verify-jwt
```

Uso:
```bash
curl "https://SEU-PROJETO.supabase.co/functions/v1/api-data?resource=services" \
     -H "Authorization: Bearer sa_xxxxxxxxxxxx"
```
`resource` pode ser `collaborators`, `services` ou `assignments`.

## 5. Importar de um CRM (entrada de dados)

Configurável em **Painel → Integrações & API** (URL, chave, mapeamento de
campos). A busca de verdade roda numa Edge Function (fonte em
`supabase/functions/crm-import`), publicada assim:

```bash
supabase functions deploy crm-import
```

**Importante:** o arquivo já vem com uma implementação completa e
funcional (autenticação, mapeamento de campos, criação de colaboradores,
limite de vagas), mas os dois pontos abaixo são genéricos por
necessidade — não existe "a" API de CRM, cada sistema tem a sua:
- o cabeçalho de autenticação usado pra chamar o CRM (hoje assume
  `Authorization: Bearer <chave>`);
- os caminhos `/collaborators` e `/services` (hoje é a convenção mais comum).

Ajuste essas duas partes do arquivo depois de olhar a documentação do CRM
real que vocês forem integrar.

## 6. Chaves e integrações de pagamento — presentes, documentadas, não conectadas

`services/assas.js` e `hooks/usePaymentReturn.js` (integração com Asaas e
Mercado Pago) continuam no projeto e as chaves seguem no `.env`, como
pedido — mas não há mais nenhuma tela usando isso, porque o modelo B2B
ainda não define como a cobrança da licença ou dos serviços deveria
funcionar (cobrança da licença em si? Repasse por serviço concluído?
Isso é uma decisão de produto, não técnica, e por isso ficou de fora desta
reconstrução). Quando essa decisão existir, a integração já está no
projeto pra ser religada.

⚠️ Como sempre: essas chaves no `.env` são de produção e ficam visíveis no
bundle público (prefixo `VITE_`). Rotacione antes de expor o projeto de
verdade.

## 7. PWA

O app é instalável (ícone, splash, modo standalone) a partir do **build de
produção** — `npm run build` gera o service worker e o manifest sozinho.
Em desenvolvimento (`npm run dev`) o service worker fica **desativado de
propósito**: um service worker interferindo em pleno desenvolvimento foi
uma dor de cabeça real neste projeto antes, e não vale o risco de repetir
isso só pra testar o modo PWA localmente. Pra testar a instalação de
verdade, rode `npm run build && npm run preview` e abra o endereço do
preview no celular (mesma rede) ou publique no Netlify.

## 8. Mapa e localização do colaborador

O mapa de rota aparece tanto na designação vista pelo colaborador quanto
pelo admin da empresa (num diálogo mais largo agora, e com o mapa mais alto
— o tamanho pequeno de antes foi ajustado), com a rota de verdade desenhada
seguindo ruas (via OSRM, serviço público e gratuito — mesma filosofia do
Nominatim já usado pra endereços; pra um volume grande de usuários
simultâneos, considere trocar por um provedor pago no futuro). Duas coisas
importantes:

- **O endereço precisa ter coordenadas pra aparecer no mapa.** Ao criar uma
  designação, se você não usar o botão de GPS no campo de endereço, o
  sistema geocodifica o endereço digitado automaticamente antes de salvar.
- **"Onde o colaborador está agora"** só aparece no mapa do admin enquanto
  a designação está **em andamento** (depois de "Iniciar atendimento"). O
  navegador do colaborador registra a posição dele a cada ~10s, e o mapa do
  admin recebe isso **em tempo real** (Realtime do Supabase, com um
  polling de reforço a cada 20s como rede de segurança) — ele vê um aviso
  na tela dizendo que a localização está sendo compartilhada nesse período.
  Fora de um atendimento em andamento, ninguém transmite nem consulta
  localização de ninguém.
- **O GPS só funciona em conexão segura** (https, ou `localhost` durante o
  desenvolvimento). Testando pelo celular direto no IP local da sua rede
  (`http://192.168.x.x:5173`) o navegador bloqueia o GPS por política de
  segurança — o mapa mostra um aviso explicando isso em vez de falhar
  silenciosamente. Publicando o app (Netlify, etc.) isso funciona normal,
  porque passa a ser `https`.
- Pra tudo isso funcionar de fato em tempo real, rode também este trecho do
  `supabase-b2b-schema.sql` (adicionado nesta versão) — ele habilita
  atualização em tempo real na tabela `profiles`:
  ```sql
  do $$
  begin
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;
  end $$;
  ```

## 9. Edição de colaboradores

Em **Painel → Colaboradores**, cada linha agora tem um botão de editar
(nome e telefone) além do de remover. O e-mail de login não pode ser
alterado por ali (isso mexeria com a autenticação, não só com o perfil).

## 10. Notificações

Um sino no topo (visível em qualquer papel) mostra notificações internas do
app, atualizadas em tempo real. Geradas automaticamente:

- **Nova designação** → avisa o colaborador.
- **Atendimento iniciado / concluído** → avisa os admins da empresa.
- **Possível desvio de rota** → avisa os admins da empresa (veja a seção
  seguinte).

Isso **não é push do celular** (não chega com o app fechado) — é uma
central de avisos dentro do próprio app. Notificação push de verdade
exigiria configurar uma chave VAPID e pedir permissão do navegador, o que é
um passo à parte, não incluído aqui.

## 11. Detecção de desvio de rota

Enquanto uma designação está em andamento, o app compara a posição do
colaborador com a rota calculada (a mesma usada pra desenhar o trajeto no
mapa) e considera "fora do trajeto" qualquer ponto a mais de 250 metros da
rota mais próxima. Quando isso acontece:

- O mapa mostra a rota em vermelho e um aviso, tanto pro colaborador quanto
  pro admin.
- Uma notificação é enviada aos admins da empresa (só uma por "episódio" de
  desvio — não fica repetindo a cada atualização de GPS).

Essa checagem é aproximada (compara contra os pontos da rota, não faz
projeção geométrica exata em cada segmento) — suficiente pra esse
propósito, mas pode ter uma margem de erro pequena em curvas fechadas.

## 12. Segurança — correções desta rodada

Uma análise mais a fundo achou (e já corrigiu) duas falhas sérias:

- **`companies` era legível por qualquer um, sem login.** A tela de
  ativação validava a chave lendo a tabela direto, o que exigia deixar
  `license_key`/`collaborator_invite_code` de todas as empresas públicos.
  Agora isso passa pelas funções `redeem_license_key`/`redeem_invite_code`
  no banco — elas fazem a checagem "por dentro" e nunca devolvem essas
  colunas pro navegador.
- **Qualquer pessoa logada conseguia se auto-promover a admin da
  plataforma ou trocar de empresa sozinha.** RLS protege linha, não
  coluna — a policy que permitia editar o próprio perfil não impedia
  alterar `is_platform_admin`/`company_id`/`company_role` diretamente. Essas
  três colunas agora têm `update` bloqueado pra qualquer usuário comum; as
  únicas formas válidas de mudá-las são as funções do banco
  (`redeem_license_key`, `redeem_invite_code`, `remove_collaborator`) ou o
  SQL Editor.

Se você já tinha rodado uma versão anterior deste arquivo, **rode o
arquivo inteiro de novo** — todos os trechos novos usam `create or replace`/
`drop policy if exists`, seguro rodar por cima do que já existe.

## 13. Chat entre colaborador e admin

Um chat interno, com mensagens cifradas, emojis e horário — acessível pelo
colaborador em `/mensagens` (ícone de balão no topo) e pelos admins da
empresa na aba **Painel → Mensagens** (lista de colaboradores à esquerda,
conversa à direita). Uma sala por colaborador — todos os admins da empresa
compartilham a mesma conversa com aquele colaborador.

**Criptografia — o que ela realmente protege:** cada sala tem uma chave
AES-256 aleatória (gerada uma vez, guardada em `chat_keys`), e cada
mensagem é cifrada com AES-256-GCM antes de ir pro banco, usando a Web
Crypto API nativa do navegador (mesma exigência de conexão segura do GPS —
https ou localhost). Isso é defesa em profundidade: protege contra um dump
de banco vazando, ou um bug futuro que exponha só a tabela de mensagens sem
também expor a de chaves. **Não é** criptografia ponta-a-ponta no sentido
estrito — quem tem acesso de service role ao projeto Supabase consegue ler
as duas tabelas e decifrar. Ponta-a-ponta de verdade (nem o servidor
conseguiria ler nunca) exigiria um par de chaves pública/privada por
pessoa, mantido só no aparelho — bem mais complexo, especialmente com
vários admins precisando ler a mesma conversa.

**Backup:** as mensagens são persistidas no Postgres do seu projeto Supabase
como qualquer outro dado do sistema — não existe um mecanismo de backup
separado só pro chat. A garantia real de backup/retenção depende do plano
do seu projeto Supabase (o plano Free tem garantias bem mais fracas que os
pagos) — vale conferir isso nas configurações do seu projeto.

**Notificação de nova mensagem** já está integrada ao sino (nunca inclui o
conteúdo da mensagem, só avisa que chegou uma).

## 14. Calendário de designações

Em Painel/Supervisão → Designações, um botão alterna entre lista e
calendário semanal (colunas por dia, navegação de semana). O calendário
busca os dados da semana visível direto do banco — não depende da
paginação da lista, então funciona corretamente mesmo com centenas de
designações.

## 15. Designações recorrentes

Ao criar uma designação, marque "Repetir esta designação" e escolha
frequência (diária/semanal) e quantas vezes. Isso cria várias linhas de
uma vez (até 52), ligadas por um `recurrence_group_id` — mais simples e
mais confiável que um motor de recorrência gerando ocorrências futuras
sozinho, mas também significa que **editar uma ocorrência não afeta as
outras** (são designações independentes desde a criação).

## 16. Reatribuir colaborador

No detalhe de uma designação ainda agendada ou em andamento, é possível
trocar o colaborador responsável direto ali — não é preciso cancelar e
criar de novo.

## 17. Fotos e assinatura

- **Antes/depois**: no detalhe da designação, tanto admin/supervisor
  quanto o colaborador podem anexar fotos (a captura no celular já abre a
  câmera). Ficam guardadas num bucket privado do Storage
  (`assignment-photos`), nunca públicas.
- **Assinatura do cliente**: ao clicar "Concluir atendimento", o
  colaborador tem a opção de pedir uma assinatura simples (dedo/mouse) na
  tela antes de confirmar — ou pular, é opcional. Fica salva como mais uma
  "foto" (tipo `signature`) da mesma designação, e agora **aparece no
  detalhe da designação** (antes era salva mas nunca era exibida em
  nenhuma tela — dava pra colher a assinatura mas não dava pra ver depois
  que ela existia).

## 18. Papel de supervisor

Um admin da empresa pode promover qualquer colaborador a supervisor
(Painel → Colaboradores → editar → Papel), e atribuir outros colaboradores
pra serem supervisionados por ele. O supervisor ganha um painel próprio
(`/supervisao`) com três abas — Minha equipe, Designações, Mensagens —
**reaproveitando os mesmos componentes do painel da empresa**: o
supervisor não vê código diferente, só que a segurança do próprio banco
(RLS) automaticamente restringe tudo que ele consulta ou cria aos
colaboradores atribuídos a ele. Um admin da empresa continua vendo/
gerenciando todo mundo normalmente.

## 19. Log de auditoria

Aba "Auditoria" no painel da empresa (e uma por empresa dentro do painel
da plataforma). Registra: designação criada, cancelada ou reatribuída,
serviço criado ou editado, colaborador/admin que entrou na empresa,
colaborador removido, papel alterado, e mudança de status de uma empresa
(ativa/suspensa). Na primeira versão só cobria as ações mais raras
(cancelamento, remoção) e por isso parecia "não registrar nada" no uso
normal — agora cobre o que de fato acontece no dia a dia. As entradas são
geradas só pelo próprio banco (funções e gatilhos), nunca por uma escrita
direta do cliente — por isso dá pra confiar que representam o que
realmente aconteceu.

## 20. Avaliação do cliente

Toda designação concluída ganha um link público de avaliação
(`/avaliar/<token>`), visível no detalhe da designação, com uma explicação
de pra que serve e um botão "Enviar por WhatsApp" (usa o telefone do
cliente já cadastrado na designação, se houver) além de copiar o link
manualmente. Não exige login: a segurança vem de um token aleatório na
URL (mesma ideia de um link de redefinição de senha). O cliente escolhe
de 1 a 5 estrelas e, opcionalmente, escreve um comentário; só pode avaliar
uma vez.

## 21. Exportação e paginação

- Botão de exportar CSV na lista de designações (abre direto no Excel/
  Planilhas Google).
- Listas de designações e do log de auditoria agora usam paginação de
  verdade (`range()` + "Carregar mais") em vez de um `limit()` fixo —
  não perdem mais itens silenciosamente conforme a empresa cresce.
  Colaboradores/serviços/empresas ainda não têm paginação (números
  tipicamente bem menores; ficou de fora desta rodada).

## 22. Notificações push de verdade

Diferente da central de notificações dentro do app (seção 10), isto
chega mesmo com o app fechado ou o celular travado — como qualquer app
nativo. Pra funcionar, precisa de três coisas:

**1. As chaves VAPID já foram geradas** (é só um par de chaves
criptográficas, sem precisar de conta em nenhum serviço de terceiro). A
pública já está no `.env` (`VITE_VAPID_PUBLIC_KEY`). A privada nunca vai
pro `.env` do app — ela é secreta só do servidor:

```bash
supabase secrets set VAPID_PRIVATE_KEY=<sua-chave-privada-vapid>
supabase secrets set VAPID_PUBLIC_KEY=<sua-chave-publica-vapid>
```

Se algum dia quiser gerar um par novo (por segurança, ou porque este
vazou por estar num chat), rode `npx web-push generate-vapid-keys` e
troque nos dois lugares (`.env` e os secrets acima).

**2. Publicar a função que envia o push:**
```bash
supabase functions deploy send-push
```

**3. A pessoa ativa manualmente** — no menu do avatar (canto superior
direito), item "Ativar notificações push". O navegador pede permissão,
e a partir daí a inscrição fica salva em `push_subscriptions`.

**O que já dispara push de verdade agora:** mandar uma mensagem no chat
(a chamada pra `send-push` já está no código). **O que ainda não dispara
sozinho:** as notificações geradas por gatilho no banco (nova designação,
início/conclusão de atendimento, desvio de rota) — pra essas chegarem
como push também, sem precisar mexer no código do app, configure um
[Database Webhook](https://supabase.com/docs/guides/database/webhooks) no
painel do Supabase: evento **INSERT** na tabela `notifications` → chama a
Edge Function `send-push` (tipo "Supabase Edge Functions", método POST),
**marcando a opção de enviar o cabeçalho de autorização com a service role**.
A função lê `user_id`, `title` e `message` direto do `record` que o webhook
manda. Sem esse cabeçalho a chamada é tratada como vinda do app e o texto
é substituído (veja abaixo).

**Segurança (Fase 0):** chamadas vindas do app só podem notificar alguém
da mesma empresa, e o texto é montado pelo servidor ("Nova mensagem"),
para ninguém conseguir mandar notificação falsa com texto próprio.

**Nota técnica:** o PWA trocou de estratégia de service worker
(`generateSW` → `injectManifest`) só por causa disso — precisava de um
service worker próprio (`src/sw.js`) pra poder tratar o evento de push.
O comportamento pra tudo mais (cache do app, atualização automática,
service worker desativado durante `npm run dev`) continua idêntico ao
de antes; foi a mudança testada com mais cuidado nesta rodada, por ser a
de maior risco.

## 23. Segurança — mais correções desta rodada

Numa nova revisão do SQL, achei (e corrigi) mais três falhas, nenhuma
delas óbvia de perceber sem ler função por função:

- **`notify_off_route` aceitava qualquer id de designação** — qualquer
  pessoa logada, de qualquer empresa, podia chamar a função com o id de
  uma designação alheia e gerar notificações falsas de "desvio de rota"
  pros admins de outra empresa. Agora só funciona se quem chama é
  realmente o colaborador daquela designação.
- **`log_audit` ficaria chamável direto pelo cliente** — sem bloquear
  isso, qualquer usuário logado poderia forjar entradas falsas no log de
  auditoria de qualquer empresa (as funções que legitimamente precisam
  chamá-la continuam funcionando normalmente).
- **`set_collaborator_role` não validava o supervisor indicado** — um
  valor manipulado ali poderia vazar acesso de leitura de um colaborador
  pra alguém de fora da empresa. Agora confirma que o id indicado é
  mesmo um supervisor da mesma empresa antes de salvar.

Se você já rodou uma versão anterior do `supabase-b2b-schema.sql`, rode
o arquivo inteiro de novo — todo o SQL usa `create or replace`/`drop ...
if exists`, seguro repetir.

## 24. Outras lacunas encontradas na análise (não corrigidas nesta rodada)

- **Sem tela de perfil** — ninguém (colaborador, admin, platform admin) tem
  como editar o próprio nome/telefone/foto depois do cadastro inicial
  (fora da edição que um admin faz de um colaborador).
- **Sem visão agregada no painel da plataforma** — só lista empresas, sem
  números consolidados (total de colaboradores/designações na plataforma).
- **Colaboradores/serviços/empresas ainda sem paginação** — só designações
  e auditoria ganharam isso nesta rodada (ver seção 21).
- **Chaves de API e do CRM ficam em texto puro no banco** — comum, mas o
  ideal seria guardar um hash e comparar hash, não o valor puro.
- **Sem monitoramento de erro** (tipo Sentry) — o ErrorBoundary só manda
  pro console; não há como você saber que um erro aconteceu em produção
  sem o usuário te contar.
- **Sem rate limiting** nas Edge Functions (`api-data`, `crm-import`,
  `send-push`).

## 25. O que ficou de fora desta reconstrução (fora do escopo técnico)

- **Redesenho visual de telas que não existem mais** — não se aplica, já
  que todas as telas do modelo antigo foram substituídas por telas novas,
  já no padrão neutro/minimalista descrito.
- **Financeiro** — cobrança da licença, faturamento por serviço,
  qualquer coisa envolvendo dinheiro de verdade. Explicitamente fora do
  pedido desta rodada.

## Estrutura do projeto

```
src/
  pages/             Welcome, Login, ResetPassword, Activate, RatingPage (pública),
                      PlatformAdmin, CompanyAdmin, SupervisorDashboard,
                      CollaboratorTasks, CollaboratorChat
  pages/company/      as abas do painel da empresa (Colaboradores, Serviços,
                      Designações, Mensagens, Integrações, reaproveitadas
                      também pelo supervisor)
  components/         AppShell, NotificationBell, ChatPanel, RouteMap,
                      AssignmentCalendar, SignaturePad,
                      AuditLogViewer, AddressPicker, ProtectedRoute,
                      RoleRoute, ErrorBoundary, ProfileLoadFallback...
  context/            AuthContext (papéis: platform / company_admin / supervisor / collaborator)
  utils/              chatCrypto, pushNotifications, csvExport, geocoding,
                      codeGenerator, validators
  theme.js            paleta neutra usada em toda a aplicação
  sw.js               service worker customizado (precache + push)
supabase-b2b-schema.sql   schema completo (rodar primeiro; seguro rodar de novo)
supabase/functions/        api-data, crm-import, send-push
```

## 26. Entregas (Fase 1)

- **Painel → Pedidos**: fila em tempo real (recebido, em preparo, pronto,
  em rota, problema), novo pedido com cliente salvo pelo telefone e taxa
  pelo bairro, despacho com várias paradas (agrupa por bairro e sugere a
  ordem), editar saída (reordenar, tirar/pôr pedido, trocar motoboy).
- **Painel → Mapa ao vivo**: motoboys, paradas e trajeto percorrido.
- **Painel → Entregas: ajustes**: bairros e taxas, modo rota exata,
  distância que conta como desvio.
- **Motoboy → /entregas** (tela inicial do colaborador): iniciar saída,
  3 opções de rota por trecho, Google Maps com todas as paradas, Waze
  para a próxima, código de entrega, "tive um problema". Posição enviada a
  cada 15 s durante a saída, com a tela mantida ligada.
- **Plataforma → empresa → Recursos liberados**: código de finalização
  de entrega e marca própria (só a plataforma liga).
- **Painel → Marca** (quando liberada): logo, ícone, imagens e cor, com a
  medida recomendada em cada campo e conferência antes de salvar.

Limitação conhecida: no navegador (PWA) a posição só é enviada com o app
aberto e a tela ligada. O app Android (Fase 2) resolve isso.

Agendar no Supabase (Database → Cron), diariamente:
`select public.purge_location_pings(90);` (apaga posições com mais de 90 dias).

Testes: `supabase/tests/run.sh` (permissões e regras, banco local) e
`supabase/tests/e2e/` (fluxo completo no navegador, veja o README de lá).

## 27. Financeiro e relatórios (Fases 3 e 4)

Tudo é calculado no banco, por funções (`report_financial`, `report_productivity`,
`report_cash_day`, `report_license_usage`, `preview_settlement`/`create_settlement`).
O navegador só mostra.

- **Empresa → Relatórios:** financeiro e produtividade por período, CSV e Imprimir/PDF.
- **Empresa → Financeiro:** caixa do dia, conferência do dinheiro, valores do motoboy, acertos, turnos e faturas da licença.
- **Motoboy:** turno na tela de entregas e aba Ganhos.
- **Plataforma:** Uso de licenças, Faturas (gerar, baixa, suspender inadimplentes) e cobrança por empresa.

Para suspender inadimplentes sozinho todo dia, agende no Supabase (Database → Cron):
`select public.apply_overdue_suspensions();`

Teste no navegador: `node supabase/tests/e2e/fluxo-financeiro.mjs` (depois do `setup.sh`).

## 28. Endereço da loja e rotas

- **Entregas: ajustes → Endereço da loja:** ponto de partida das rotas; a busca de endereço dos pedidos dá preferência para a cidade e a região da loja.
- **Novo pedido:** o endereço é digitado (busca com sugestões ou campos), localizado no mapa automaticamente; dá para clicar no mapa ou arrastar o marcador. Pedido sem ponto no mapa não é criado.
- **Motoboy:** a saída mostra o trajeto completo (loja → paradas); cada trecho sai da parada anterior (ou da loja), então a rota aparece mesmo sem GPS. "Recalcular a partir daqui" usa a posição atual.
- **Mapa ao vivo e detalhe do pedido:** trajeto previsto a partir da loja.

Teste no navegador: `node supabase/tests/e2e/fluxo-loja-rotas.mjs`.

## 29. Busca de endereço (rua e número)

- **CEP (opcional)**: preenche rua, bairro e cidade oficiais (ViaCEP).
- **Sem chave do Google** (padrão): usa OpenStreetMap (Photon + Nominatim). No Brasil o mapa gratuito quase nunca tem o número das casas, então o ponto fica na rua e a tela avisa isso; para o ponto exato, clique no mapa ou arraste o marcador.
- **Com chave do Google** (`VITE_GOOGLE_MAPS_API_KEY` no Netlify): sugestões e localização exatas até o número.
  1. Google Cloud: crie um projeto com faturamento e ative *Maps JavaScript API*, *Places API (New)* e *Geocoding API*.
  2. Crie uma chave e restrinja a *Sites (referenciadores HTTP)*: `appgerencrm.netlify.app/*`.
  3. Netlify → Environment variables: `VITE_GOOGLE_MAPS_API_KEY` = a chave. Se o build falhar no *secrets scanning*, adicione `SECRETS_SCAN_OMIT_KEYS` = `VITE_GOOGLE_MAPS_API_KEY` (a chave do Maps fica no navegador mesmo; a proteção é a restrição por site).
  4. Faça um novo deploy.
- O script do banco termina com `notify pgrst, 'reload schema'`, que resolve o erro "Could not find the column ... in the schema cache" depois de rodar.

## 30. Cardápio e taxa do motoboy

- **Aba Cardápio** (admin da empresa): categorias, produtos com descrição e
  preço único ou opções de preço (ex.: Hambúrguer / Frango ou lombo, Normal /
  Aberto) e adicionais (Bacon, Catupiry...). Dá para editar, reordenar, tirar
  do cardápio (interruptor) ou excluir. O supervisor só lê.
- **Novo pedido**: os itens são escolhidos do cardápio (opção, adicionais,
  quantidade, observação). O valor não é digitado: o banco calcula pelos
  preços do cardápio (`create_delivery_order` / `set_order_items`) e grava o
  preço do momento em `delivery_order_items`.
- **Taxa do motoboy**: ao despachar, o valor por entrega do motoboy (Financeiro →
  Valores do motoboy; o dele ou o padrão da empresa) vai para
  `delivery_orders.courier_fee` e entra no total, separado da taxa do bairro.
  Trocar o motoboy da saída troca a taxa; tirar o pedido da saída zera.
  Desliga em "Entregas: ajustes".
- **Cardápio inicial**: `supabase/seeds/cardapio-pantera-lanches.sql` (rodar
  depois do schema; ajuste o nome da empresa na primeira linha do bloco).

## 31. Expediente e despacho automático

- **Expediente** (app do motoboy): "Iniciar expediente", "Pausar" / "Voltar a
  receber" e "Encerrar expediente". O gestor vê quem está em expediente na
  fila de pedidos e pode pausar, liberar ou encerrar.
- **Despacho automático** ("Entregas: ajustes"): quando um motoboy em
  expediente fica livre, o banco (`auto_dispatch`) monta a saída começando
  pelo pedido que espera há mais tempo e junta os que ficam no caminho
  (inserção mais barata no trajeto loja → paradas → loja), respeitando o
  máximo de entregas e o desvio máximo da empresa. Não enche até o máximo:
  só junta o que compensa.
- **Quando roda**: pedido fica pronto (ou chega, se configurado), saída
  termina, motoboy entra/volta do expediente, ajustes mudam; e a cada minuto
  pelo pg_cron (se disponível) e a cada 30 s pelas telas abertas.
- **Falhas cobertas**: um despacho por empresa por vez (trava), erro no
  despacho nunca bloqueia a ação do motoboy/gestor, saída não iniciada no
  prazo volta para a fila e o motoboy fica em pausa, pausar/encerrar devolve
  a saída ainda não iniciada.

## 32. Pedido local (balcão) x entrega

- **Novo pedido** começa escolhendo "Entrega" ou "Pedido local". Na entrega
  aparecem endereço, mapa, complemento e taxa de entrega (endereço com ponto
  no mapa continua obrigatório). No pedido local só aparecem os campos do
  pedido; nome e telefone são opcionais.
- **No banco**: `delivery_orders.order_type` ('delivery' | 'local'). Pedido
  local nunca tem endereço, taxa de entrega nem código de entrega, não entra
  em saída (manual ou automática) e o tipo não muda depois de criado.
- **Concluir**: no detalhe do pedido local, "Entregue ao cliente"
  (`complete_local_order`, admin ou supervisor). O pagamento já fica
  conferido, porque foi feito no caixa. No financeiro aparece como
  "Pedido local" no lugar do bairro, e não entra nos tempos de entrega.
