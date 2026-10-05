import { buildApp } from './app';
import { env } from './config/env';

async function main() {
  const app = await buildApp({
    logger:
      env.NODE_ENV === 'development'
        ? { level: 'debug', transport: { target: 'pino-pretty' } }
        : { level: 'info' },
  });

  const encerrar = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (erro) {
    app.log.error(erro);
    process.exit(1);
  }
}

void main();
