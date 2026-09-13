import { IsArray, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum SoulCommentModeDto {
  AUTO = 'AUTO',
  REVIEW_ALL = 'REVIEW_ALL',
  OFF = 'OFF',
}

// Regra de comentários de um Customer (ou padrão da organização quando customerId é nulo).
export class SoulCommentRuleDto {
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsEnum(SoulCommentModeDto)
  mode: SoulCommentModeDto;

  // Rótulos que respondem sozinhos (padrão: PRAISE, QUESTION_ANSWERABLE)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  autoLabels?: string[];

  // Rótulos ignorados sem resposta (padrão: SPAM)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ignoreLabels?: string[];

  // Como o perfil fala (pra resposta automática): pessoa, tom, o que nunca dizer
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  voiceProfile?: string;

  // Resumo do que o perfil é e onde estão as fontes (entra no prompt do classificador e do gerador)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  knowledgeSummary?: string;

  // URL de API/site consultado pelo gerador de resposta (ex.: Directus do acervo)
  @IsOptional()
  @IsString()
  knowledgeUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  notifyEmails?: string[];
}
