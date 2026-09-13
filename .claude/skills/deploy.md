# Skill: deploy do soulpostiz em produção

Pipeline real, validado no primeiro deploy (12/09/2026, `v2.23.0-soul.1`).
Sem CI e sem staging: build e troca acontecem no próprio VPS
(`root@72.60.241.188`, Postiz em `/opt/postiz`).

## Antes

- Fila de publicação nas próximas horas: `SELECT count(*) FROM "Post" WHERE
  state='QUEUE' AND "deletedAt" IS NULL AND "publishDate" BETWEEN now() AND
  now() + interval '2 hours'`. Se houver post perto, esperar: o container fica
  fora do ar por 20 a 40 s no `up -d`. Evitar 12h e 18h BRT (acervo).
- Memória: o VPS tem 16 GB e roda Plane, Zammad, n8n e Postiz. O build precisa
  de ~4 GB de heap (Node) mais o `pnpm install`. Em 12/09 foi criado um swap de
  8 GB (`/swapfile`, no fstab) como rede de segurança; o build usou 3,3 GB dele.
  Conferir `free -m` antes.

## Build (5 a 8 min)

```bash
cd /opt/soulpostiz-src && git fetch origin && git checkout soulmkt-main && git pull
TAG=v2.23.0-soul.N   # N incrementa a cada deploy
nohup docker build -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=$TAG \
  -t soulpostiz:$TAG . > /root/soulpostiz-build-$TAG.log 2>&1 &
```

Mesmo Dockerfile e mesmo build-arg do workflow oficial
(`.github/workflows/build-containers.yml`). `NEXT_PUBLIC_VERSION` aparece no
rodapé do Postiz e em `docker exec postiz printenv NEXT_PUBLIC_VERSION`.
Imagem final ~3,6 GB, igual à oficial. Acompanhar com `tail -f` do log; o fim
é `naming to docker.io/library/soulpostiz:$TAG`.

## Troca (script pronto)

```bash
/root/soulpostiz-deploy.sh v2.23.0-soul.N
```

O script: confere que a imagem existe → **dump do Postgres** em
`/root/postiz-pre-<tag>-<data>.sql.gz` → backup do compose → troca a linha
`image:` do serviço `postiz` → `docker compose up -d postiz` → espera
`healthy` → imprime front (307 é o esperado, redireciona pro login), as
variáveis das redes e a versão → **espera a API responder** (`/api/user/self`
devolvendo 401; se continuar 502 por 3 min, faz `pm2 restart backend` e espera de
novo, porque o backend do pm2 já travou em silêncio no boot) → imprime a linha
de **rollback**.

Na subida o `pm2-run` roda `prisma db push` contra o banco de produção. É o
comportamento do upstream; migração nossa entra como migração nomeada no
código, mas o `db push` continua rodando no start.

## Conferir

1. `docker ps` mostra `postiz soulpostiz:<tag> (healthy)`.
2. `docker exec postiz pm2 jlist | jq '.[] | .name+" "+.pm2_env.status'`:
   backend, orchestrator e frontend `online`.
3. Logs sem erro: `docker logs postiz --since 3m 2>&1 | grep -i -E "error|exception"`
   (ignorar `connect() failed` do nginx nos primeiros segundos).
3b. `curl -s -o /dev/null -w "%{http_code}" https://postiz.soulmkt.com.br/api/user/self`
   devolve **401** (backend no ar). 502 = backend travado no boot mesmo com pm2
   `online`; `docker exec postiz pm2 restart backend` e conferir de novo.
4. Login no Postiz, calendário abre, `integrationList` pelo MCP responde.
5. Contagem de posts igual à de antes.

## Rollback

```bash
sed -i "s#image: soulpostiz:<tag>#image: $(cat /root/postiz-previous-image.txt)#" /opt/postiz/docker-compose.yml
cd /opt/postiz && docker compose up -d postiz
```

Se a versão nova tiver alterado o schema, restaurar o dump antes de subir a
imagem anterior. Imagens antigas ficam no host; limpar com `docker image rm`
só depois de dois deploys estáveis.

## Registrar

Card do SPTZ com: tag, commit da `soulmkt-main`, dump gerado, o que mudou pra
quem usa, como conferir. Atualizar `.claude/docs/customizacoes-implementadas.md`.
