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
- ドメイン登録と権威 DNS は Cloudflare。Worker のカスタムドメインは `www.fukubaka0825.dev`、apex は Cloudflare Redirect Rule で `https://www.fukubaka0825.dev` に 301 リダイレクトする
- `public/CNAME` は不要。旧 Route 53 の DNS 情報を保持する利用者向けに、GitHub Pages と `gh-pages` ブランチは一時的に残している。現在の本番デプロイには使用しない

## 旧 GitHub Pages の停止

Cloudflare Registrar の移管は完了している。DNS の切り替え時にキャッシュされた旧 Route 53 の NS レコードは、移管完了とは別に期限が切れるまで残り得る。実際に切り替え直後は、公開 DNS が Cloudflare を返しても、一部の端末の `www` への HTTPS 接続は GitHub Pages に到達した。旧 NS の TTL は切り替え時に約 48 時間だったため、切り替えから少なくとも 48 時間は Pages を停止しない。

期限が過ぎたら、公開 DNS と端末の両方で `www` の A / AAAA レコードが Cloudflare を指し、apex から `www` への 301 リダイレクトと既存ページの表示が正常なことを確認する。その後、GitHub の Settings → Pages で公開元ブランチを `None` にして Pages を停止し、不要な `gh-pages` ブランチを削除する。最後に、この暫定運用の記述を `AGENTS.md` と本ファイルから削除する。

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
