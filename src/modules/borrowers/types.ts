export interface CreateBorrowerDto {
  borrowerCode: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  address?: string;
}
