import { UserRole } from '@prisma/client';

export interface RegisterUserDto {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface SanitizedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  token: string;
  user: SanitizedUser;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
}
