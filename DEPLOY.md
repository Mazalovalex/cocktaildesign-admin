# Deploy notes

## Uploads (media)

- В проде `public/uploads` НЕ хранится в репозитории.
- На сервере это symlink:
  `public/uploads -> /home/deploy/strapi_storage/uploads`
- Папка `public/uploads` добавлена в `.gitignore`, чтобы git pull не ломал медиа.

## Database

- Локально по умолчанию используется SQLite (см. `.env`).
- На сервере используется PostgreSQL (см. переменные окружения сервера).
- База данных не должна лежать в репозитории и не должна зависеть от `git pull`.
