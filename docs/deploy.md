# Deploy / CI

## 本番へのリリース手順

`main` の変更は Cloudflare Workers Builds がビルドして https://www.fukubaka0825.dev に公開する。直接 push はせず、PR を経由する。

1. ブランチを切って実装する（`git switch -c feat/xxx`）
2. `npm run ci && npm run test:e2e` を通す（[development.md](development.md)）
3. 見た目を変えたら QA エージェントで検証し、P0/P1 を修正する（[testing.md](testing.md)）
4. 見た目を変えた場合は空きポートでプレビューを立ち上げて本人に確認してもらう（`npx astro preview --port <空きポート>`）
5. push して PR を作る

   ```sh
   git push -u origin feat/xxx
   gh pr create --fill
   ```

6. PR の CI（`ci.yml`: lint / 型チェック / build / Playwright / Lighthouse）が通るのを待つ

   ```sh
   gh pr checks --watch
   ```

7. merge する（`gh pr merge --squash --delete-branch`）
8. Cloudflare Dashboard → Workers & Pages → `fukubaka0825-portfolio` → Builds で `main` のビルド成功を確認する
9. 本番を確認する
   - `curl -q -sI https://www.fukubaka0825.dev/ | head -1` が 200
   - `PLAYWRIGHT_BASE_URL=https://www.fukubaka0825.dev npx playwright test` を実行する
   - 必要なら本番の Lighthouse を計測する（`lighthouserc.prod.json`）

### ロールバック

Cloudflare Dashboard → Workers & Pages → `fukubaka0825-portfolio` → Deployments で直前の正常なデプロイへ戻す。原因を修正したら PR を作り、`main` に merge して再デプロイする。DNS の切り替えは不要。

## 全体像

```
PR ──> ci.yml: biome ci → astro check → build(SKIP_FEEDS) → Playwright → Lighthouse(dist)
main push ──> Workers Builds: npm run build(フィード取得あり) → npx wrangler deploy → Workers Static Assets
毎日 06:17 JST ──> deploy.yml: Deploy Hook に POST → Workers Builds が最新の main を再ビルド
```

- Worker 名は `fukubaka0825-portfolio`。`wrangler.jsonc` の `assets.directory` は `./dist`、HTML は末尾スラッシュを保ち、存在しないパスには `404.html` を返す
- Worker のカスタムドメインは `www.fukubaka0825.dev`。Cloudflare DNS が権威 DNS、apex は Cloudflare Redirect Rule で `https://www.fukubaka0825.dev` に 301 リダイレクトする
- GitHub Pages の `gh-pages` ブランチと `public/CNAME` は公開に使わない

## Secrets

GitHub Actions のリポジトリ Secret `CLOUDFLARE_WORKERS_DEPLOY_HOOK` に、Worker の Settings → Builds → Deploy Hooks で作成した `main` 用 URL を設定する。URL 自体が認証情報なので、ログやリポジトリに記録しない。GitHub への通常の push は Cloudflare の Git 連携で自動デプロイするため、この Secret は定期・手動の再ビルド専用。

## 定期ビルドと手動デプロイ

外部フィードの新着を反映するため、毎日 06:17 JST に最新の `main` を再ビルドする。外部フィードの取得に失敗してもサイトのビルドは継続する。手動で再ビルドする場合は GitHub Actions → Rebuild external feeds → Run workflow を使う。

## 切り分け

- **本番が更新されない**: Worker の Builds で対象コミットのビルドとデプロイ結果を確認する。GitHub 連携のブランチが `main` か確認する
- **定期更新が動かない**: Actions の Rebuild external feeds を確認し、`CLOUDFLARE_WORKERS_DEPLOY_HOOK` が設定されているか確認する。Hook URL は表示しない
- **独自ドメインが表示されない**: Worker の Settings → Domains & Routes に `www.fukubaka0825.dev` があるか、Cloudflare DNS の `www` が Worker に向いているか確認する
- **Writing が空になった**: Worker の Builds ログで `[feeds] skip <媒体>` を探す。外部サービスの一時的な失敗なら次のビルドで回復する
- **Lighthouse が落ちた**: PR 側は `lighthouserc.json`（a11y / best-practices / SEO は error）。本番側 `lighthouserc.prod.json` は warn のみ
