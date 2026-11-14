import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import prisma from '../../config/database';
import { config } from '../../config';
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../../utils/errors';
import { auditService } from '../audit/audit.service';
import {
  RegisterUserDto,
  LoginDto,
  SanitizedUser,
  AuthResponse,
  JwtPayload,
} from './types';

export class AuthService {
  private readonly saltRounds = 10;

  /**
   * Generates a signed JWT for the user.
   */
  generateToken(user: { id: string; email: string; role: UserRole }): string {
    const payload: JwtPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);
  }

  /**
   * Verifies and decodes a JWT token.
   */
  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, config.jwt.secret) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }

  /**
   * Registers a new user with hashed password.
   */
  async register(
    dto: RegisterUserDto,
    actorId?: string,
    ipAddress?: string
  ): Promise<SanitizedUser> {
    if (!dto.email || !dto.password || !dto.name) {
      throw new ValidationError('Email, password, and name are required');
    }

    if (dto.password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters long');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new ConflictError(`User with email '${normalizedEmail}' already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, this.saltRounds);
    const role = dto.role ?? UserRole.LOAN_OFFICER;

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name: dto.name.trim(),
        role,
        isActive: true,
      },
    });

    // Audit log
    await auditService.logAction({
      userId: actorId ?? user.id,
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      after: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      ipAddress,
    });

    return this.sanitizeUser(user);
  }

  /**
   * Authenticates user by email and password, returning JWT and sanitized user.
   */
  async login(dto: LoginDto, ipAddress?: string): Promise<AuthResponse> {
    if (!dto.email || !dto.password) {
      throw new ValidationError('Email and password are required');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = this.generateToken(user);

    // Audit log
    await auditService.logAction({
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: user.role },
      ipAddress,
    });

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Retrieves a sanitized user by ID.
   */
  async getUserById(id: string): Promise<SanitizedUser> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${id}' not found`);
    }

    return this.sanitizeUser(user);
  }

  /**
   * Strips password and sensitive fields from user object.
   */
  sanitizeUser(user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SanitizedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export const authService = new AuthService();
