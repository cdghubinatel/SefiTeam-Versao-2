import { z } from 'zod';

/**
 * Mensagem do primeiro erro de validação do schema, num idioma do Zod escolhido explicitamente
 * (ignora a configuração global). Serve para os testes não dependerem do texto da tradução.
 */
export function mensagemDoZod(schema: z.ZodType, valor: unknown, idioma: 'ptBR' | 'en') {
  const { localeError } = z.locales[idioma]();
  return schema.safeParse(valor, { error: localeError }).error?.issues[0]?.message;
}
