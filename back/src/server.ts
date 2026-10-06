import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp({
    logger:
      env.NODE_ENV === 'development'
        ? { level: 'debug', transport: { target: 'pino-pretty' } }
        : { level: 'info' },
  });

  const encerrar = async () => {
    try {
      await app.close();
      process.exit(0);
    } catch (erro) {
      app.log.error(erro, 'Falha ao encerrar o servidor');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void encerrar());
  process.on('SIGTERM', () => void encerrar());

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (erro) {
    app.log.error(erro);
    process.exit(1);
  }
}

void main();
