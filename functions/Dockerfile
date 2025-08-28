# Node.js 22の公式イメージを使用
FROM node:22-slim

# 作業ディレクトリを作成
WORKDIR /usr/src/app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存ライブラリをインストール
RUN npm install

# アプリケーションのソースコードをコピー
COPY . .

# アプリケーションがリッスンするポート
EXPOSE 8080

# アプリケーションを起動
CMD [ "npm", "start" ]