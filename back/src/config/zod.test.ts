import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './zod.js';
import { mensagemDoZod } from '../test/zod.js';

describe('configuração do Zod', () => {
  it('as mensagens de validação usam a tradução pt-BR do Zod', () => {
    const schema = z.email();
    const atual = schema.safeParse('x').error?.issues[0]?.message;

    // Compara com o próprio Zod em vez de um texto fixo: o teste não quebra se uma versão
    // nova do Zod mudar a tradução, mas falha se a configuração deixar de ser aplicada.
    expect(atual).toBe(mensagemDoZod(schema, 'x', 'ptBR'));
    expect(atual).not.toBe(mensagemDoZod(schema, 'x', 'en'));
  });
});
