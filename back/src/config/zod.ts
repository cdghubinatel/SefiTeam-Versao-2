import { z } from 'zod';

/**
 * Mensagens de validação do Zod em português (tradução pt-BR do próprio Zod). A configuração é
 * global e precisa rodar antes de qualquer validação: por isso é o primeiro import de
 * `config/env.ts` (validado ao subir a API) e dos seeds.
 */
z.config(z.locales.ptBR());
