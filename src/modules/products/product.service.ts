import prisma from '../../config/database';
import { LoanProduct, InterestType, RepaymentFrequency } from '@prisma/client';
import { CreateProductDto } from './types';
import { PREDEFINED_PRODUCTS } from './predefined';
import { ValidationError, NotFoundError, ConflictError } from '../../utils/errors';

export class ProductService {
  /**
   * Creates a new loan product with domain validations.
   */
  async createProduct(dto: CreateProductDto): Promise<LoanProduct> {
    this.validateProductDto(dto);

    const existing = await prisma.loanProduct.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictError(`Loan product with name '${dto.name}' already exists`);
    }

    return prisma.loanProduct.create({
      data: {
        name: dto.name,
        description: dto.description,
        interestType: dto.interestType,
        repaymentFrequency: dto.repaymentFrequency,
        interestRateBps: dto.interestRateBps,
        minTenureMonths: dto.minTenureMonths,
        maxTenureMonths: dto.maxTenureMonths,
        minAmountPaise: dto.minAmountPaise,
        maxAmountPaise: dto.maxAmountPaise,
        penaltyRateBps: dto.penaltyRateBps ?? 0,
        processingFeeBps: dto.processingFeeBps ?? 0,
      },
    });
  }

  /**
   * Retrieves a loan product by ID.
   */
  async getProductById(id: string): Promise<LoanProduct> {
    const product = await prisma.loanProduct.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundError(`Loan product with ID '${id}' not found`);
    }
    return product;
  }

  /**
   * Retrieves a loan product by Name.
   */
  async getProductByName(name: string): Promise<LoanProduct> {
    const product = await prisma.loanProduct.findUnique({ where: { name } });
    if (!product) {
      throw new NotFoundError(`Loan product with name '${name}' not found`);
    }
    return product;
  }

  /**
   * Lists all active loan products.
   */
  async listActiveProducts(): Promise<LoanProduct[]> {
    return prisma.loanProduct.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Seeds the three mandatory loan products if they do not already exist.
   */
  async seedPredefinedProducts(): Promise<LoanProduct[]> {
    const results: LoanProduct[] = [];
    for (const key of Object.keys(PREDEFINED_PRODUCTS)) {
      const def = PREDEFINED_PRODUCTS[key];
      const product = await prisma.loanProduct.upsert({
        where: { name: def.name },
        update: {
          interestType: def.interestType,
          repaymentFrequency: def.repaymentFrequency,
          interestRateBps: def.interestRateBps,
          minTenureMonths: def.minTenureMonths,
          maxTenureMonths: def.maxTenureMonths,
          minAmountPaise: def.minAmountPaise,
          maxAmountPaise: def.maxAmountPaise,
          penaltyRateBps: def.penaltyRateBps,
          processingFeeBps: def.processingFeeBps,
        },
        create: {
          name: def.name,
          description: def.description,
          interestType: def.interestType,
          repaymentFrequency: def.repaymentFrequency,
          interestRateBps: def.interestRateBps,
          minTenureMonths: def.minTenureMonths,
          maxTenureMonths: def.maxTenureMonths,
          minAmountPaise: def.minAmountPaise,
          maxAmountPaise: def.maxAmountPaise,
          penaltyRateBps: def.penaltyRateBps ?? 0,
          processingFeeBps: def.processingFeeBps ?? 0,
        },
      });
      results.push(product);
    }
    return results;
  }

  /**
   * Validates loan application parameters against product business rules.
   */
  validateLoanAgainstProduct(
    product: LoanProduct,
    principalPaise: bigint,
    tenure: number
  ): void {
    if (!product.isActive) {
      throw new ValidationError(`Loan product '${product.name}' is inactive and cannot be applied for`);
    }

    if (principalPaise < product.minAmountPaise) {
      throw new ValidationError(
        `Principal amount ${principalPaise} paise is below product minimum of ${product.minAmountPaise} paise`
      );
    }

    if (principalPaise > product.maxAmountPaise) {
      throw new ValidationError(
        `Principal amount ${principalPaise} paise exceeds product maximum of ${product.maxAmountPaise} paise`
      );
    }

    if (tenure < product.minTenureMonths) {
      throw new ValidationError(
        `Tenure ${tenure} is below product minimum of ${product.minTenureMonths}`
      );
    }

    if (tenure > product.maxTenureMonths) {
      throw new ValidationError(
        `Tenure ${tenure} exceeds product maximum of ${product.maxTenureMonths}`
      );
    }
  }

  /**
   * Validates product DTO constraints.
   */
  private validateProductDto(dto: CreateProductDto): void {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new ValidationError('Product name is required');
    }

    if (!Object.values(InterestType).includes(dto.interestType)) {
      throw new ValidationError(`Invalid interest type: ${dto.interestType}`);
    }

    if (!Object.values(RepaymentFrequency).includes(dto.repaymentFrequency)) {
      throw new ValidationError(`Invalid repayment frequency: ${dto.repaymentFrequency}`);
    }

    if (dto.interestRateBps < 0) {
      throw new ValidationError('Interest rate in basis points cannot be negative');
    }

    if (dto.minAmountPaise <= 0n) {
      throw new ValidationError('Minimum amount must be greater than zero paise');
    }

    if (dto.maxAmountPaise < dto.minAmountPaise) {
      throw new ValidationError('Maximum amount must be greater than or equal to minimum amount');
    }

    if (dto.minTenureMonths <= 0) {
      throw new ValidationError('Minimum tenure must be greater than zero');
    }

    if (dto.maxTenureMonths < dto.minTenureMonths) {
      throw new ValidationError('Maximum tenure must be greater than or equal to minimum tenure');
    }
  }
}

export const productService = new ProductService();
