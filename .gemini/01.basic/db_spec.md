# データベース設計仕様書

## 概要

本ドキュメントは、Prezento AI CoachアプリケーションにおけるFirestoreのデータベース設計と、その設計に至った戦略を定義する。

## コレクション設計

### 1. `users`

ユーザーの基本情報を格納する。

- **パス**: `users/{userId}`
- **ドキュメント構成**:
  - `displayName` (string): ユーザー表示名
  - `email` (string): メールアドレス
  - `createdAt` (timestamp): アカウント作成日時

#### サブコレクション: `sessions`

ユーザーごとの練習セッションの履歴を格納する。

- **パス**: `users/{userId}/sessions/{sessionId}`
- **ドキュメント構成**:
  - `mode` (string): 練習モード ('presenter', 'thinking' など)
  - `persona` (string): 設定したペルソナ
  - `scores` (map): 各評価項目のスコア
  - `totalScore` (number): 総合スコア
  - `highlight` (string): 良かった点
  - `advice` (string): 改善点
  - `...` (その他、分析結果)
  - `createdAt` (timestamp): セッション完了日時

### 2. `missions`

ミッションモードのお題や設定を格納する。

- **パス**: `missions/{missionId}`
- **ドキュメント構成**:
  - `title` (string): ミッションのタイトル
  - `description` (string): ミッションの詳細説明
  - `objective` (string): Geminiが採点に使うクリア条件
  - `persona` (string): AIの役割
  - `level` (number): 難易度

### 3. `mission_results`

全ユーザーのミッション挑戦結果を**履歴**として格納するコレクション。

- **パス**: `mission_results/{resultId}`
- **ドキュメント構成**:
  - `userId` (string): 挑戦したユーザーのID
  - `userName` (string): 挑戦したユーザーの表示名 (非正規化データ)
  - `missionId` (string): 挑戦したミッションのID
  - `score` (number): 採点結果のスコア
  - `success` (boolean): ミッションの成否
  - `message` (string): AIからの総評
  - `createdAt` (timestamp): 挑戦日時

### 4. `mission_high_scores`

ミッションごとの、ユーザー別最高得点を格納するコレクション。**ランキング表示の読み取りを最適化**するために使用する。

- **パス**: `mission_high_scores/{missionId}_{userId}` (複合キー)
- **ドキュメント構成**:
  - `missionId` (string): ミッションのID
  - `userId` (string): ユーザーのID
  - `userName` (string): ユーザーの表示名
  - `score` (number): そのミッションにおける、そのユーザーの最高得点
  - `updatedAt` (timestamp): 最高得点の更新日時

## 設計戦略

### `mission_results` と `mission_high_scores` を併用する理由 (戦略C)

当初、API側で全履歴を都度集計する案（戦略A）や、ミッションのサブコレクションでランキングを管理する案（戦略B）も検討された。しかし、最終的に**履歴用の `mission_results`** と**ランキング集計用の `mission_high_scores`** を併用する戦略Cを採用した。

1.  **読み取りパフォーマンスの最大化**:
    -   ランキング表示の際は、最適化された `mission_high_scores` コレクションのみをクエリする。これにより、`where` と `orderBy` を組み合わせた非常に高速かつ安価なデータ取得が可能になる。
    -   データ量が増加しても、APIの応答速度とFirestoreの読み取りコストを低く抑えることができる。

2.  **書き込み処理の堅牢性**:
    -   ミッション採点時には、Firestoreトランザクションを利用して以下をアトミックに実行する。
        1.  `mission_results` に今回の挑戦履歴を書き込む。
        2.  `mission_high_scores` から、複合キー `{missionId}_{userId}` で既存の最高得点を読み取る。
        3.  今回のスコアが既存の最高得点を上回る場合のみ、`mission_high_scores` のドキュメントを更新（または新規作成）する。
    -   このアプローチにより、書き込み処理はやや複雑化するものの、データの整合性を保ちつつ、読み取り側の負荷を劇的に削減できる。

3.  **データ活用の柔軟性**:
    -   `mission_results` には全履歴が残っているため、ユーザー個人の成長記録を詳細に表示したり、将来的に別の角度からデータを分析したりといった拡張性も確保される。
