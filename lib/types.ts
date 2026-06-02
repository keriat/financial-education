export type Kid = {
  id: string;
  name: string;
  sort: number;
  available: number;
  interest_anchor: string | null;
};

export type Action = {
  id: string;
  label: string;
  amount: number;
  sort: number;
};

export type TxType = "earn" | "save" | "unsave" | "payout" | "interest";

export type Tx = {
  id: string;
  kid_id: string;
  type: TxType;
  label: string;
  amount: number;
  created_at: string;
};
