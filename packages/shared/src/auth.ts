export type AccountRole = "player" | "admin" | "super_admin";
export type AccountStatus = "active" | "disabled";

export interface CurrentUserDto {
  id: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
}

export interface RegisterRequestDto {
  email: string;
  password: string;
  activationCode: string;
}

export interface RegisterResponseDto {
  user: CurrentUserDto;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface AuthSessionDto {
  user: CurrentUserDto;
  csrfToken: string;
}
