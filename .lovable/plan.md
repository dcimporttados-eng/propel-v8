
# Migração do backend para Supabase externo

O frontend (`pavilhao8.com.br`) e o domínio continuam hospedados pela Lovable. Só o **backend** (banco, edge functions, secrets) muda para um projeto Supabase na sua conta.

## Pré-requisitos (você faz antes)

1. Criar conta em https://supabase.com (se ainda não tiver).
2. Criar um novo projeto Supabase — recomendo região **South America (São Paulo)**, plano **Pro ($25/mês)** para suportar cron jobs e webhooks de produção.
3. Anotar do novo projeto: **Project URL**, **anon key**, **service_role key**, **Database password** (você vai me passar pela tela de secrets, com segurança).
4. Ter em mãos seu **MERCADOPAGO_ACCESS_TOKEN** (já existe hoje, vou recadastrar).

## Etapas que eu executo

### 1. Ativar modo manutenção
Reaproveito a `MaintenanceScreen` já existente para travar o site durante a janela de migração.

### 2. Export do banco atual
- Dump completo do schema + dados via `pg_dump` do Cloud atual.
- Salvo em `/mnt/documents/pavilhao8_backup_<data>.sql` (backup que fica com você).

### 3. Restore no Supabase externo
- Restaurar o dump no novo projeto.
- Recriar enums (`payment_status`, `reservation_status`), tabelas, RLS policies, e a function `get_available_spots` (ambas sobrecargas).
- Validar contagem de linhas (users, classes, reservations, payments, class_suspensions) — origem vs destino devem bater 100%.

### 4. Recriar cron job
- Habilitar `pg_cron` e `pg_net` no novo projeto.
- Recriar o agendamento `expire-reservations` apontando para a nova URL de função.

### 5. Redeploy das edge functions
Mesmo código, novo destino:
- `reserve`
- `webhook-mercadopago`
- `webhook-cakto`
- `expire-reservations`

A `back_urls` para `propel-v8.lovable.app` continua igual; só a `notification_url` muda automaticamente porque é montada a partir de `SUPABASE_URL`.

### 6. Recadastrar secret
- `MERCADOPAGO_ACCESS_TOKEN` no novo projeto (peço pelo `add_secret`).

### 7. Trocar a conexão do frontend
**Este é o ponto sensível.** O `src/integrations/supabase/client.ts` e o arquivo `.env` são gerenciados pela Lovable e apontam para o Cloud atual. Para apontar pro seu Supabase externo eu vou:
- **Desconectar o Lovable Cloud** (via Connectors → Lovable Cloud → Disable).
- **Conectar o Supabase externo** via Connectors → Supabase, usando as credenciais do seu novo projeto.
- A Lovable regenera `client.ts`, `types.ts` e `.env` automaticamente apontando para o novo backend.

Aviso importante: depois disso, o painel do banco fica no **app.supabase.com**, não mais dentro da Lovable. Você terá controle total lá.

### 8. Atualizar Mercado Pago
Você (ou eu, se tiver o token de painel) precisa atualizar a URL de webhook no painel do Mercado Pago para:
```
https://<NOVO_PROJECT_REF>.supabase.co/functions/v1/webhook-mercadopago
```
Como hoje a `notification_url` é enviada por preferência (na própria chamada do `reserve`), novas reservas já apontam pro destino certo automaticamente. Mas se houver webhook configurado **globalmente** no painel MP, atualizar lá também.

### 9. Smoke test
- Criar uma reserva de teste de R$0,01 (ou cancelar antes do pagamento).
- Verificar logs da edge function `reserve` no novo projeto.
- Confirmar que o Admin Dashboard lê os dados.
- Confirmar que `expire-reservations` rodou via cron.

### 10. Sair do modo manutenção
Remover o lock e publicar.

## Janela e downtime

- **Tempo total estimado**: 45–90 min com você acompanhando.
- **Downtime efetivo de pagamento**: ~30 min (tempo do dump→restore→troca de connector).
- **Recomendação**: fazer entre 02h–05h, quando não há pagamentos ativos.

## O que NÃO muda

- Domínio `pavilhao8.com.br`
- Código do frontend (componentes, páginas, lógica)
- URLs de retorno do checkout (`propel-v8.lovable.app/confirmacao`)
- Comportamento visível para o cliente final

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Pagamento em trânsito durante a troca | Janela de manutenção + escolher horário sem tráfego |
| Webhook MP cair antes de atualizar URL | A `notification_url` é por-preferência, então só afeta reservas criadas no exato momento do corte |
| Erro no restore de dados | Backup completo `.sql` salvo antes, rollback possível |
| Perda de cron job | Recriado manualmente no passo 4 com validação |

## Custos depois da migração

- **Supabase Pro**: $25/mês fixo (inclui 8GB DB, 100GB transfer, cron, sem pause).
- **Lovable**: continua só o plano de build/hosting do frontend. Cloud balance deixa de ser consumido.

## Confirmações necessárias antes de eu começar

1. Você já criou o projeto Supabase externo? (se não, crie e me avise quando tiver as credenciais)
2. Confirma janela de manutenção? Sugiro hoje à noite após 23h ou madrugada.
3. Quer que eu salve o backup `.sql` em `/mnt/documents/` para você guardar fora da Lovable também?

Quando me confirmar esses 3 pontos e tiver as credenciais do novo projeto em mãos, eu começo pela etapa 1.
