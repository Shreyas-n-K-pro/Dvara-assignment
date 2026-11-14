import { LoanProduct } from '@prisma/client';
import {
  generateRepaymentSchedule,
  ScheduleGenerationParams,
  GeneratedSchedule,
} from './calculator';
import { productService } from '../products/product.service';
import { ValidationError } from '../../utils/errors';

export interface ScheduleReconciliationResult {
  isReconciled: boolean;
  originalPrincipalPaise: bigint;
  scheduledPrincipalPaise: bigint;
  principalDifferencePaise: bigint;
  totalInterestPaise: bigint;
  totalRepaymentPaise: bigint;
  installmentCount: number;
}

export class ScheduleService {
  /**
   * Generates a repayment schedule based on raw parameters.
   */
  generateSchedule(params: ScheduleGenerationParams): GeneratedSchedule {
    return generateRepaymentSchedule(params);
  }

  /**
   * Validates product constraints and generates the repayment schedule.
   */
  generateScheduleForProduct(
    product: LoanProduct,
    principalPaise: bigint,
    tenure: number,
    startDate: Date
  ): GeneratedSchedule {
    productService.validateLoanAgainstProduct(product, principalPaise, tenure);

    return generateRepaymentSchedule({
      principalPaise,
      interestRateBps: product.interestRateBps,
      tenure,
      frequency: product.repaymentFrequency,
      interestType: product.interestType,
      startDate,
    });
  }

  /**
   * Performs rigorous financial reconciliation on a generated repayment schedule.
   *
   * Verifies:
   * 1. Sum of all scheduled principal installments equals original principal to the exact paise.
   * 2. For every installment, principalPaise + interestPaise === totalPaise.
   * 3. Total schedule repayment === total principal + total interest.
   * 4. Final installment leaves exactly 0 outstanding principal.
   * 5. No negative principal or interest amounts exist in any installment.
   */
  reconcileSchedule(
    originalPrincipalPaise: bigint,
    schedule: GeneratedSchedule
  ): ScheduleReconciliationResult {
    let sumPrincipal = 0n;
    let sumInterest = 0n;
    let sumTotal = 0n;

    for (const inst of schedule.installments) {
      if (inst.principalPaise < 0n) {
        throw new ValidationError(
          `Installment #${inst.installmentNumber} has negative principal: ${inst.principalPaise}`
        );
      }

      if (inst.interestPaise < 0n) {
        throw new ValidationError(
          `Installment #${inst.installmentNumber} has negative interest: ${inst.interestPaise}`
        );
      }

      if (inst.principalPaise + inst.interestPaise !== inst.totalPaise) {
        throw new ValidationError(
          `Installment #${inst.installmentNumber} internal sum mismatch: principal (${inst.principalPaise}) + interest (${inst.interestPaise}) !== total (${inst.totalPaise})`
        );
      }

      sumPrincipal += inst.principalPaise;
      sumInterest += inst.interestPaise;
      sumTotal += inst.totalPaise;
    }

    const principalDifference = sumPrincipal - originalPrincipalPaise;
    const isReconciled =
      principalDifference === 0n &&
      sumPrincipal === schedule.totalPrincipalPaise &&
      sumInterest === schedule.totalInterestPaise &&
      sumTotal === schedule.totalAmountPaise;

    if (!isReconciled) {
      throw new ValidationError(
        `Schedule reconciliation failed: original principal (${originalPrincipalPaise}) != scheduled principal (${sumPrincipal}). Difference: ${principalDifference} paise.`
      );
    }

    // Verify last installment leaves zero balance
    const lastInstallment = schedule.installments[schedule.installments.length - 1];
    if (lastInstallment && lastInstallment.outstandingPrincipalPaise !== 0n) {
      throw new ValidationError(
        `Final outstanding balance is ${lastInstallment.outstandingPrincipalPaise} paise, expected 0 paise.`
      );
    }

    return {
      isReconciled: true,
      originalPrincipalPaise,
      scheduledPrincipalPaise: sumPrincipal,
      principalDifferencePaise: principalDifference,
      totalInterestPaise: sumInterest,
      totalRepaymentPaise: sumTotal,
      installmentCount: schedule.installments.length,
    };
  }
}

export const scheduleService = new ScheduleService();
