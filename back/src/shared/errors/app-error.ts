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
    super(401, 'CREDENCIAIS_INVALIDAS', 'Login ou senha inválidos.');
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

export class MuitasTentativas extends AppError {
  constructor() {
    super(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente novamente.');
  }
}
