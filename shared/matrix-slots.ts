export interface MatrixSlotCard {
  level: number;
  cycle: number;
  status: "locked" | "open" | "completed";
  filled: number;
  paid: number;
  capacity: number;
}

export interface MatrixSlotCatalog {
  memberId: string;
  items: MatrixSlotCard[];
  page: number;
  pageSize: number;
  total: number;
  levels: { level: number; slots: number; unlocked: number; completed: number; rebirths: number }[];
}
