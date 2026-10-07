/**
 * Erro de negócio com status HTTP e código estável.
 * O error handler central converte em `{ erro: { codigo, mensagem } }`.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'AppError';
  }
}

export class CredenciaisInvalidas extends AppError {
  constructor() {
    super(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos.');
  }
}

export class TokenAusente extends AppError {
  constructor() {
    super(401, 'TOKEN_AUSENTE', 'Faça login para continuar.');
  }
}

export class TokenInvalido extends AppError {
  constructor() {
    super(401, 'TOKEN_INVALIDO', 'Sessão inválida ou expirada. Faça login novamente.');
  }
}

export class SemPermissao extends AppError {
  constructor() {
    super(403, 'SEM_PERMISSAO', 'Você não tem permissão para acessar este recurso.');
  }
}

/** Recurso inexistente (ex.: `:id` que não está no banco). Mesmo código da rota inexistente. */
export class NaoEncontrado extends AppError {
  constructor(mensagem = 'Recurso não encontrado.') {
    super(404, 'NAO_ENCONTRADO', mensagem);
  }
}

/** A lista enviada para reordenar não bate com as dúvidas do banco (alguém criou ou apagou uma). */
export class OrdemDesatualizada extends AppError {
  constructor() {
    super(409, 'ORDEM_DESATUALIZADA', 'A lista de dúvidas mudou. Recarregue e tente novamente.');
  }
}

/** O aluno já tem grupo nesta Física (cada aluno fica em um único grupo por Física). */
export class JaEmGrupo extends AppError {
  constructor(mensagem = 'Você já está em um grupo nesta Física.') {
    super(409, 'JA_EM_GRUPO', mensagem);
  }
}

export class MuitasTentativas extends AppError {
  constructor() {
    super(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente novamente.');
  }
}
