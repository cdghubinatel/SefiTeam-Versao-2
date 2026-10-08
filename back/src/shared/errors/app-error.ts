export type DetalheErro = { campo: string; mensagem: string };

/**
 * Erro de negócio com status HTTP e código estável.
 * O error handler central converte em `{ erro: { codigo, mensagem, detalhes? } }`.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: DetalheErro[],
  ) {
    super(mensagem);
    this.name = 'AppError';
  }
}

/**
 * Dado inválido que só o service consegue checar (ex.: depende do usuário logado).
 * Mesmo formato do erro de validação do schema, com o campo em `detalhes`.
 */
export class DadosInvalidos extends AppError {
  constructor(campo: string, mensagem: string) {
    super(400, 'VALIDACAO', 'Dados inválidos.', [{ campo, mensagem }]);
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

/** Ação do aluno depois da data limite da edição (o admin não tem prazo). */
export class PrazoEncerrado extends AppError {
  constructor() {
    super(409, 'PRAZO_ENCERRADO', 'O prazo para formar grupos já terminou.');
  }
}

/** O grupo passaria do máximo de integrantes da Física. */
export class GrupoCheio extends AppError {
  constructor(maximoIntegrantes: number) {
    super(409, 'GRUPO_CHEIO', `O grupo pode ter no máximo ${maximoIntegrantes} integrantes.`);
  }
}

/** A Física já tem a quantidade máxima de grupos. */
export class LimiteDeGrupos extends AppError {
  constructor() {
    super(409, 'LIMITE_DE_GRUPOS', 'Esta Física já atingiu o número máximo de grupos.');
  }
}

/** Multiturma desligado e o aluno é de outra turma. */
export class TurmaDiferente extends AppError {
  constructor(mensagem = 'Este grupo só aceita alunos da mesma turma.') {
    super(409, 'TURMA_DIFERENTE', mensagem);
  }
}

export class MuitasTentativas extends AppError {
  constructor() {
    super(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente novamente.');
  }
}
