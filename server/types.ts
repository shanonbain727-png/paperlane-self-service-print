export type Settings = {
  shopName: string; deviceName: string; accepting: boolean; phone: string;
  address: string; hours: string; coverNote: string; showName: boolean;
  simplexPrice: number; duplexPrice: number; retentionHours: number;
};
export type FileRow = { id: string; owner: string; name: string; size: number; ext: string; status: string; pages: number; error: string | null; created: number; expires: number };
export type PrintOptions = { fileIds: string[]; copies: number; duplex: boolean; name: string };
export type Snapshot = PrintOptions & { files: { id: string; name: string; pages: number }[]; pages: number; amount: number; unitPrice: number; settings: Settings };
export type OrderRow = { id: string; owner: string; code: string; snapshot: string; status: string; paid: number; created: number; expires: number; error: string | null; output_pages: number };
export type PrintJob = { id: string; source: string; duplex: boolean; copies: 1 };
export interface PrintAdapter { mode: string; submit(job: PrintJob): Promise<{ state: 'artifact_ready'; output: string }> }
export interface PaymentAdapter { mode: string; confirm(orderId: string): { reference: string } }
