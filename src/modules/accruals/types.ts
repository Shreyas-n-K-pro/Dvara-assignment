export interface TriggerAccrualDto {
  loanId: string;
  accrualDate?: Date | string;
  interestPaise: bigint | number | string;
  description?: string;
}

export interface AccrualResult {
  accrualRecordId: string;
  loanId: string;
  accrualDate: Date;
  interestPaise: bigint;
  ledgerTransactionId: string;
}
