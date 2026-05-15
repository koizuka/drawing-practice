# サプライチェーン攻撃対策チェックリスト

自分の各リポジトリに横展開するための共通手順書。攻撃面は大きく
**GitHub Actions / npm / Go パッケージ** の3つ、加えて **GitHub リポジトリ設定**。
`drawing-practice` リポジトリを実装済みの実例として参照する。

各項目の `✅` は drawing-practice で対応済み、`☐` は適用時に確認するもの。

---

## 0. 最初にやること（全リポジトリ共通）

1. このチェックリストをリポジトリに配置（または社内 wiki などに集約）。
2. GitHub のリポジトリ **Settings** のセキュリティ系ページで以下を有効化
   （GitHub は UI 改名が頻繁。「Code security and analysis」→「Advanced
   Security」など、メニュー名は時期により変わる。機能名で探す）：
   - Dependabot alerts / Dependabot security updates
   - Secret Protection（旧 Secret scanning）+ Push Protection
   - Private vulnerability reporting
   - Non-provider patterns（汎用シークレット検出）/ Validity checks（漏洩
     トークンの有効性検証）は有償の GitHub Secret Protection（Team /
     Enterprise 向け）の追加機能。個人リポジトリのプランではトグル自体が
     現れないことがあり、その場合は対象外でよい（設定漏れではない）。本体の
     Secret Protection + Push Protection が有効なら標準対策として十分。
3. **Settings → Actions → General → Workflow permissions** を
   **「Read repository contents and packages permissions」**（read-only 既定）に。
   - こうしておくと、`permissions:` を書き忘れたワークフローが書き込み権限を
     持つ事故を防げる。
4. `main` にブランチ保護 / ruleset：
   - Require a pull request before merging
   - Require status checks（CI の集約ジョブ。drawing-practice では `CI Summary`）
   - Block force pushes
5. `SECURITY.md` と `CODEOWNERS` を配置（脆弱性報告窓口とレビュー必須化）。

---

## 1. GitHub Actions

サードパーティ Action は実行時に任意コードを走らせられるため、最重要対策面。

- ☐ **すべてのサードパーティ Action を commit SHA で固定**する。
  タグ（`@v4`）やブランチ（`@main`）は可変で、乗っ取られると差し替えられる。
  ```yaml
  # NG: タグは可変
  - uses: actions/checkout@v6
  # OK: SHA 固定 + 可読性のためタグをコメント
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  ```
  → `/github-actions-hash-pinning` スキルで一括変換できる。
  GitHub 公式（`actions/*`）も例外にせず固定するのが望ましい。
- ☐ **`permissions:` を最小権限で明示**する。ワークフロー既定を
  `contents: read` にし、書き込みが要るジョブだけ個別に昇格する。
  ```yaml
  permissions:
    contents: read          # ワークフロー全体の既定
  jobs:
    deploy:
      permissions:
        contents: write     # このジョブだけ昇格
  ```
  未使用スコープ（`pages: write` / `id-token: write` など）は付けない。
- ☐ **`pull_request_target` + フォークコードの checkout を併用しない**。
  `pull_request_target` はベースリポジトリの権限・シークレットで動くため、
  フォーク PR のコードをチェックアウトして実行すると権限昇格になる。
  通常の CI は `pull_request` を使う。
- ☐ シークレットを**必要なジョブ/ステップにだけ**渡す。フォーク PR から走る
  ジョブにシークレットを露出しない。
- ☐ `run:` の中で `${{ github.event.* }}`（PR タイトル等の任意入力）を
  直接展開しない（シェルインジェクション）。`env:` 経由で受ける。
- ☐ `concurrency:` を設定し、古い実行をキャンセルして無駄＆競合を防ぐ。
- ☐ Dependabot に `github-actions` ecosystem を追加し、固定 SHA を自動更新する
  （固定 = 塩漬けにしない。更新は Dependabot に任せる）。

drawing-practice の状況：✅ 全 Action を SHA 固定。✅ `permissions` 最小化
（`.github/workflows/test.yml`：既定 `contents: read`、`pr-preview` のみ昇格）。
✅ `pull_request_target` 不使用。✅ `concurrency` 設定済み。✅ Dependabot 対応。

---

## 2. npm（Node.js）

- ☐ **`package-lock.json` をコミット**し、CI は **`npm ci`** を使う
  （`npm install` はロックを書き換え得る）。`lockfileVersion` は 3 を推奨。
- ☐ **Dependabot に `cooldown` を設定**する。公開直後の悪性バージョンを掴む
  リスクを下げる（数日寝かせてから採用）。
  ```yaml
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
  ```
- ☐ **CI に `npm audit` を非ブロックで追加**する。深刻度の高い既知脆弱性を
  可視化する。判定の主軸は GitHub の Dependabot alerts。
  ```yaml
  # --package-lock-only: ロックファイルだけで監査し、npm ci のインストールを省く
  - name: npm audit (report only)
    run: npm audit --package-lock-only --audit-level=high --omit=dev || true
  ```
- ☐ **Node バージョンを固定**する。`.nvmrc` と `package.json` の `engines`、
  CI の `setup-node` を一致させ、ローカルと CI の差異をなくす。
- ☐ **ライフサイクルスクリプトを点検**する。`postinstall` / `preinstall` /
  `prepare` は `npm install` 時に任意コードを実行する。直接・推移依存に
  不審なものがないか確認する。
  ```bash
  # インストール時に走るスクリプトを一覧
  npm ci --dry-run --foreground-scripts
  ```
  どうしても固める場合は CI で `npm ci --ignore-scripts`。ただしネイティブ
  バイナリをビルドする依存があると壊れるので、例外管理が必要（上級者向け）。
- ☐ `.npmrc` でプライベートレジストリを使うなら、認証トークンを
  リポジトリにコミットしない（`${NPM_TOKEN}` 等の環境変数参照にする）。
- ☐ 依存追加時はパッケージ名のタイポスクワッティングに注意（`crossenv` 等）。

drawing-practice の状況：✅ lockfile コミット＆`npm ci`。✅ Dependabot
`cooldown: 7`。✅ CI に `audit` ジョブ追加（report-only）。✅ `.nvmrc` +
`engines: node>=22`。✅ postinstall 等なし（直接・推移依存とも）。

---

## 3. Go

- ☐ **`go.sum` をコミット**する。モジュールのハッシュ検証の要。
- ☐ **`GOFLAGS=-mod=readonly`** を CI に設定し、ビルドが `go.mod`/`go.sum` を
  暗黙に書き換えないようにする。
- ☐ **`GOSUMDB`（既定 `sum.golang.org`）を無効化しない**。`GONOSUMCHECK` や
  `GOFLAGS=-insecure`、`GOSUMDB=off` を安易に使わない。社内プロキシを使う
  場合も checksum DB は維持する。
- ☐ **`govulncheck` を CI に追加**する。Go 公式の脆弱性スキャナで、実際に
  到達するコードパスだけを報告するため誤検知が少ない。
  ```yaml
  - name: govulncheck
    run: |
      go install golang.org/x/vuln/cmd/govulncheck@v1.1.4  # バージョン固定
      govulncheck ./...
  ```
  または `golang/govulncheck-action` を **SHA 固定**で使う。
- ☐ **`go mod tidy` 差分チェック**を CI に入れ、`go.mod`/`go.sum` が
  最新・最小であることを保証する。
  ```yaml
  - run: go mod tidy
  - run: git diff --exit-code go.mod go.sum
  ```
- ☐ **Dependabot に `gomod` ecosystem を追加**する。
  ```yaml
  - package-ecosystem: gomod
    directory: "/"
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
  ```
- ☐ `actions/setup-go` など Go ワークフロー内の Action も **SHA 固定**。
- ☐ `go vet` ＋ `staticcheck` を CI に入れる（品質面だが供給網由来の不審な
  コードの検知にも寄与）。
- ☐ ビルドツールを `go run tool@version` で都度取得する箇所はバージョンを
  固定する（`@latest` は使わない）。Go 1.24+ なら `go.mod` の `tool`
  ディレクティブで管理する。

---

## 4. GitHub リポジトリ設定（ファイル化できない・手動）

Web UI もしくは `gh` CLI で設定する。`gh` 例：

```bash
# 既定トークンを read-only に
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -f default_workflow_permissions=read

# Dependabot security updates を有効化
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes

# private vulnerability reporting を有効化
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
```

- ☐ Workflow permissions = read-only 既定
- ☐ Dependabot alerts / security updates 有効
- ☐ Secret scanning + push protection 有効
- ☐ Private vulnerability reporting 有効
- ☐ `main` ブランチ保護（PR 必須・必須ステータスチェック・force push 禁止）
- ☐ Allowed actions を「GitHub 製＋自分の Action＋必要なサードパーティのみ」に
  絞る（任意・厳しめ）

---

## 5. 横展開の進め方

1. リポジトリごとに本チェックリストをコピーし、`☐` を埋めながら点検する。
2. GitHub Actions の SHA 固定は `/github-actions-hash-pinning` スキルで自動化。
3. 言語ごとの対策（npm / Go）は該当セクションのみ適用。
4. リポジトリ設定（セクション4）は1回設定すれば以後維持される。
5. 固定した依存・Action は Dependabot に更新を任せ、塩漬けにしない。
