import React, { useEffect, useMemo, useState } from 'react';

type VoucherType = 'e-voucher' | 'gift-card' | 'physical';
type SellRequestStatus =
  | 'Pending'
  | 'Reviewing'
  | 'Quoted'
  | 'Accepted'
  | 'Rejected'
  | 'Verified'
  | 'Awaiting Payment'
  | 'Paid'
  | 'Stocked';
type InventoryStatus = 'Pending Verification' | 'Available' | 'Reserved' | 'Sold' | 'Expired' | 'Locked';
type BuyOrderStatus = 'Pending Payment' | 'Payment Submitted' | 'Paid Verified' | 'Delivered' | 'Cancelled' | 'Refunded';
type DisputeStatus = 'Open' | 'Investigating' | 'Resolved' | 'Closed';
type PageKey = 'home' | 'vouchers' | 'detail' | 'sell' | 'lookup' | 'guide' | 'policy' | 'contact' | 'admin';
type AdminTab = 'dashboard' | 'buyback' | 'inventory' | 'orders' | 'pricing' | 'customers' | 'disputes' | 'logs';

interface Brand {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

interface PricingRule {
  id: string;
  brandId: string;
  voucherType: VoucherType;
  faceValue: number;
  buybackRate: number;
  defaultSellPrice: number;
  active: boolean;
}

interface SellRequest {
  id: string;
  requestCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  brandId: string;
  voucherType: VoucherType;
  faceValue: number;
  quantity: number;
  expiryDate: string;
  voucherNote: string;
  evidenceSummary: string;
  estimatedUnitBuyPrice: number;
  finalUnitBuyPrice?: number;
  finalTotalBuyPrice?: number;
  status: SellRequestStatus;
  rejectionReason?: string;
  payoutReference?: string;
  createdAt: string;
  updatedAt: string;
}

interface InventoryItem {
  id: string;
  sourceSellRequestId?: string;
  brandId: string;
  voucherType: VoucherType;
  faceValue: number;
  costPrice: number;
  sellPrice: number;
  expiryDate: string;
  maskedCode: string;
  demoFulfillmentToken: string;
  status: InventoryStatus;
  reservedByOrderId?: string;
  stockedAt: string;
  updatedAt: string;
}

interface BuyOrder {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  inventoryItemIds: string[];
  brandId: string;
  faceValue: number;
  quantity: number;
  totalAmount: number;
  transferReference?: string;
  status: BuyOrderStatus;
  deliveredDemoVoucherTokens?: string[];
  createdAt: string;
  updatedAt: string;
}

interface DisputeTicket {
  id: string;
  ticketCode: string;
  orderOrRequestCode: string;
  customerPhone: string;
  reason: string;
  status: DisputeStatus;
  resolutionNote?: string;
  createdAt: string;
}

interface AuditLog {
  id: string;
  actor: string;
  action: string;
  summary: string;
  createdAt: string;
}

interface StoreState {
  brands: Brand[];
  pricingRules: PricingRule[];
  sellRequests: SellRequest[];
  inventory: InventoryItem[];
  buyOrders: BuyOrder[];
  disputes: DisputeTicket[];
  auditLogs: AuditLog[];
}

const SELL_TRANSITIONS: Record<SellRequestStatus, SellRequestStatus[]> = {
  Pending: ['Reviewing', 'Quoted', 'Rejected'],
  Reviewing: ['Quoted', 'Rejected'],
  Quoted: ['Accepted', 'Rejected'],
  Accepted: ['Verified', 'Rejected'],
  Rejected: [],
  Verified: ['Awaiting Payment', 'Rejected'],
  'Awaiting Payment': ['Paid', 'Rejected'],
  Paid: ['Stocked'],
  Stocked: [],
};

const INVENTORY_TRANSITIONS: Record<InventoryStatus, InventoryStatus[]> = {
  'Pending Verification': ['Available', 'Locked', 'Expired'],
  Available: ['Reserved', 'Locked', 'Expired'],
  Reserved: ['Sold', 'Available', 'Locked', 'Expired'],
  Sold: [],
  Expired: ['Locked'],
  Locked: ['Available', 'Expired'],
};

const DB_NAME = 'voucher_exchange_mvp_db';
const STORE_NAME = 'snapshot';
const SNAPSHOT_KEY = 'state_v1';
const ADMIN_HASH_KEY = 'vx_demo_admin_pass_hash';

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
const formatDateVN = (iso: string) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '-');
const isExpired = (d: string) => d < new Date().toISOString().slice(0, 10);
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const genCode = (p: string) =>
  `${p}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
const maskCode = (raw: string) => `VC-****-****-${raw.trim().slice(-4).toUpperCase() || '0000'}`;

async function sha256Hex(text: string): Promise<string> {
  if (window.crypto?.subtle) {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return text;
}

function createSeedState(): StoreState {
  const now = new Date().toISOString();
  const futureLong = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  const futureSoon = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  return {
    brands: [
      { id: 'br-gotit', name: 'Got It Multi-Brand', category: 'Đa thương hiệu', active: true },
      { id: 'br-urbox', name: 'UrBox E-Gift', category: 'Đa thương hiệu', active: true },
      { id: 'br-starbucks', name: 'Starbucks Vietnam', category: 'F&B', active: true },
      { id: 'br-cgv', name: 'CGV Cinemas', category: 'Giải trí', active: true },
      { id: 'br-grab', name: 'GrabGifts', category: 'Di chuyển', active: true },
    ],
    pricingRules: [
      { id: 'pr-1', brandId: 'br-gotit', voucherType: 'e-voucher', faceValue: 500_000, buybackRate: 0.86, defaultSellPrice: 465_000, active: true },
      { id: 'pr-2', brandId: 'br-gotit', voucherType: 'e-voucher', faceValue: 1_000_000, buybackRate: 0.87, defaultSellPrice: 925_000, active: true },
      { id: 'pr-3', brandId: 'br-urbox', voucherType: 'e-voucher', faceValue: 500_000, buybackRate: 0.85, defaultSellPrice: 460_000, active: true },
      { id: 'pr-4', brandId: 'br-starbucks', voucherType: 'gift-card', faceValue: 200_000, buybackRate: 0.80, defaultSellPrice: 178_000, active: true },
      { id: 'pr-5', brandId: 'br-grab', voucherType: 'e-voucher', faceValue: 300_000, buybackRate: 0.84, defaultSellPrice: 276_000, active: true },
    ],
    inventory: [
      { id: 'inv-1001', brandId: 'br-gotit', voucherType: 'e-voucher', faceValue: 500_000, costPrice: 430_000, sellPrice: 465_000, expiryDate: futureLong, maskedCode: 'VC-****-****-4912', demoFulfillmentToken: 'DEMO-TOKEN-GOTIT-4912', status: 'Available', stockedAt: now, updatedAt: now },
      { id: 'inv-1002', brandId: 'br-gotit', voucherType: 'e-voucher', faceValue: 1_000_000, costPrice: 870_000, sellPrice: 925_000, expiryDate: futureLong, maskedCode: 'VC-****-****-8821', demoFulfillmentToken: 'DEMO-TOKEN-GOTIT-8821', status: 'Available', stockedAt: now, updatedAt: now },
      { id: 'inv-1003', brandId: 'br-starbucks', voucherType: 'gift-card', faceValue: 200_000, costPrice: 160_000, sellPrice: 178_000, expiryDate: futureSoon, maskedCode: 'VC-****-****-3309', demoFulfillmentToken: 'DEMO-TOKEN-SBX-3309', status: 'Available', stockedAt: now, updatedAt: now },
      { id: 'inv-1004', brandId: 'br-urbox', voucherType: 'e-voucher', faceValue: 500_000, costPrice: 425_000, sellPrice: 460_000, expiryDate: futureLong, maskedCode: 'VC-****-****-7715', demoFulfillmentToken: 'DEMO-TOKEN-URBOX-7715', status: 'Sold', stockedAt: now, updatedAt: now },
    ],
    sellRequests: [
      { id: 'sell-demo-1', requestCode: 'SELL-20261123-0001', customerName: 'Nguyễn Minh Tuấn', customerPhone: '0901234567', brandId: 'br-grab', voucherType: 'e-voucher', faceValue: 300_000, quantity: 1, expiryDate: futureLong, voucherNote: 'E-voucher GrabGifts mẫu', evidenceSummary: 'Ảnh chụp xác minh mẫu', estimatedUnitBuyPrice: 252_000, status: 'Pending', createdAt: now, updatedAt: now },
    ],
    buyOrders: [
      { id: 'ord-demo-1', orderCode: 'ORD-20261123-0001', customerName: 'Trần Thu Hà', customerPhone: '0912345678', inventoryItemIds: ['inv-1004'], brandId: 'br-urbox', faceValue: 500_000, quantity: 1, totalAmount: 460_000, transferReference: 'FT263279910', status: 'Delivered', deliveredDemoVoucherTokens: ['DEMO-TOKEN-URBOX-7715'], createdAt: now, updatedAt: now },
    ],
    disputes: [],
    auditLogs: [
      { id: 'log-1', actor: 'system', action: 'INIT_DEMO', summary: 'Khởi tạo dữ liệu mẫu IndexedDB (không lưu mã voucher thật)', createdAt: now },
    ],
  };
}

async function idbLoad(): Promise<StoreState> {
  if (typeof indexedDB === 'undefined') return createSeedState();
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE_NAME, 'readonly');
      const getReq = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      getReq.onsuccess = () => resolve((getReq.result as StoreState) ?? createSeedState());
      getReq.onerror = () => resolve(createSeedState());
    };
    req.onerror = () => resolve(createSeedState());
  });
}

async function idbSave(state: StoreState): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    Pending: 'bg-slate-100 text-slate-700 border-slate-300',
    Reviewing: 'bg-blue-50 text-blue-700 border-blue-200',
    Quoted: 'bg-amber-50 text-amber-800 border-amber-300',
    Accepted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    Verified: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    'Awaiting Payment': 'bg-orange-50 text-orange-800 border-orange-200',
    Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Stocked: 'bg-[#0B1F3A] text-white border-[#0B1F3A]',
    Available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Reserved: 'bg-amber-50 text-amber-800 border-amber-200',
    Sold: 'bg-slate-200 text-slate-700 border-slate-300',
    Expired: 'bg-rose-50 text-rose-700 border-rose-200',
    Locked: 'bg-zinc-200 text-zinc-700 border-zinc-300',
    'Pending Payment': 'bg-amber-50 text-amber-800 border-amber-200',
    'Payment Submitted': 'bg-blue-50 text-blue-700 border-blue-200',
    Delivered: 'bg-emerald-600 text-white border-emerald-600',
    Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
};

export function App() {
  const [store, setStore] = useState<StoreState | null>(null);
  const [page, setPage] = useState<PageKey>('home');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const [buyName, setBuyName] = useState('');
  const [buyPhone, setBuyPhone] = useState('');
  const [buyEmail, setBuyEmail] = useState('');
  const [activeOrder, setActiveOrder] = useState<BuyOrder | null>(null);
  const [buyTransferRef, setBuyTransferRef] = useState('');
  const [buyMsg, setBuyMsg] = useState('');
  const [buyErr, setBuyErr] = useState('');

  const [sellName, setSellName] = useState('');
  const [sellPhone, setSellPhone] = useState('');
  const [sellEmail, setSellEmail] = useState('');
  const [sellBrand, setSellBrand] = useState('br-gotit');
  const [sellType, setSellType] = useState<VoucherType>('e-voucher');
  const [sellFace, setSellFace] = useState(500_000);
  const [sellQty, setSellQty] = useState(1);
  const [sellExpiry, setSellExpiry] = useState(new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10));
  const [sellNote, setSellNote] = useState('');
  const [sellEvidence, setSellEvidence] = useState('');
  const [sellCreated, setSellCreated] = useState<SellRequest | null>(null);
  const [sellErr, setSellErr] = useState('');

  const [lookupCode, setLookupCode] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupResult, setLookupResult] = useState<{ kind: 'sell'; id: string } | { kind: 'buy'; id: string } | null>(null);
  const [lookupTransferRef, setLookupTransferRef] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [lookupMsg, setLookupMsg] = useState('');
  const [lookupErr, setLookupErr] = useState('');

  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminAuthErr, setAdminAuthErr] = useState('');
  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [adminMsg, setAdminMsg] = useState('');
  const [adminErr, setAdminErr] = useState('');
  const [quoteInputs, setQuoteInputs] = useState<Record<string, number>>({});
  const [payoutInputs, setPayoutInputs] = useState<Record<string, string>>({});
  const [stockSellPrices, setStockSellPrices] = useState<Record<string, number>>({});
  const [stockCodes, setStockCodes] = useState<Record<string, string>>({});

  const [newInvBrand, setNewInvBrand] = useState('br-gotit');
  const [newInvFace, setNewInvFace] = useState(500_000);
  const [newInvCost, setNewInvCost] = useState(425_000);
  const [newInvSell, setNewInvSell] = useState(465_000);
  const [newInvExpiry, setNewInvExpiry] = useState(new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10));
  const [newInvCode, setNewInvCode] = useState('');

  const [ruleBrand, setRuleBrand] = useState('br-gotit');
  const [ruleFace, setRuleFace] = useState(500_000);
  const [ruleRate, setRuleRate] = useState(0.85);
  const [ruleSell, setRuleSell] = useState(465_000);

  useEffect(() => {
    idbLoad().then((s) => setStore(s));
  }, []);

  const updateStore = async (mutator: (draft: StoreState) => void) => {
    if (!store) return;
    const clone: StoreState = JSON.parse(JSON.stringify(store));
    mutator(clone);
    setStore(clone);
    await idbSave(clone);
  };

  const availableItems = useMemo(() => {
    if (!store) return [];
    return store.inventory.filter((i) => i.status === 'Available' && !isExpired(i.expiryDate));
  }, [store]);

  const filteredItems = useMemo(() => {
    if (!store) return [];
    return availableItems.filter((item) => {
      const b = store.brands.find((x) => x.id === item.brandId);
      const okBrand = brandFilter === 'ALL' || item.brandId === brandFilter;
      const okType = typeFilter === 'ALL' || item.voucherType === typeFilter;
      const q = search.trim().toLowerCase();
      const okSearch = !q || (b?.name.toLowerCase().includes(q) ?? false) || String(item.faceValue).includes(q);
      return okBrand && okType && okSearch;
    });
  }, [store, availableItems, brandFilter, typeFilter, search]);

  const estimatedSell = useMemo(() => {
    if (!store) return { rate: 0.75, unit: 0, total: 0 };
    const r = store.pricingRules.find(
      (x) => x.active && x.brandId === sellBrand && x.voucherType === sellType && x.faceValue === sellFace
    );
    const rate = r ? r.buybackRate : 0.75;
    const unit = Math.round(sellFace * rate);
    return { rate, unit, total: unit * sellQty };
  }, [store, sellBrand, sellType, sellFace, sellQty]);

  const report = useMemo(() => {
    if (!store) return null;
    const grossRevenue = store.buyOrders.filter((b) => b.status === 'Delivered').reduce((a, b) => a + b.totalAmount, 0);
    const soldCogs = store.inventory.filter((i) => i.status === 'Sold').reduce((a, i) => a + i.costPrice, 0);
    const unsoldCost = store.inventory
      .filter((i) => i.status === 'Available' || i.status === 'Reserved' || i.status === 'Pending Verification')
      .reduce((a, i) => a + i.costPrice, 0);
    const buybackPaid = store.sellRequests
      .filter((s) => s.status === 'Paid' || s.status === 'Stocked')
      .reduce((a, s) => a + (s.finalTotalBuyPrice ?? s.estimatedUnitBuyPrice * s.quantity), 0);
    const today = new Date().toISOString().slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    return {
      grossRevenue,
      soldCogs,
      grossProfit: grossRevenue - soldCogs,
      unsoldCost,
      buybackPaid,
      availableCount: store.inventory.filter((i) => i.status === 'Available').length,
      reservedCount: store.inventory.filter((i) => i.status === 'Reserved').length,
      soldCount: store.inventory.filter((i) => i.status === 'Sold').length,
      expiringSoonCount: store.inventory.filter((i) => (i.status === 'Available' || i.status === 'Reserved') && i.expiryDate >= today && i.expiryDate <= in14).length,
    };
  }, [store]);

  if (!store || !report) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">Đang khởi tạo dữ liệu demo IndexedDB...</div>;
  }

  const selectedItem = store.inventory.find((i) => i.id === selectedItemId) ?? null;

  const handleCreateSell = async (e: React.FormEvent) => {
    e.preventDefault();
    setSellErr('');
    if (!/^0\d{8,10}$/.test(sellPhone.trim())) {
      setSellErr('Số điện thoại Việt Nam phải bắt đầu bằng 0 và có 9–11 số.');
      return;
    }
    if (isExpired(sellExpiry)) {
      setSellErr('Voucher đã hết hạn sử dụng, không thể gửi thu mua.');
      return;
    }
    const now = new Date().toISOString();
    const created: SellRequest = {
      id: uid('sell'),
      requestCode: genCode('SELL'),
      customerName: sellName.trim(),
      customerPhone: sellPhone.trim(),
      customerEmail: sellEmail.trim() || undefined,
      brandId: sellBrand,
      voucherType: sellType,
      faceValue: sellFace,
      quantity: sellQty,
      expiryDate: sellExpiry,
      voucherNote: sellNote.trim(),
      evidenceSummary: sellEvidence.trim(),
      estimatedUnitBuyPrice: estimatedSell.unit,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    };
    await updateStore((d) => {
      d.sellRequests.unshift(created);
    });
    setSellCreated(created);
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyErr('');
    if (!selectedItem) return;
    if (!/^0\d{8,10}$/.test(buyPhone.trim())) {
      setBuyErr('Số điện thoại không hợp lệ.');
      return;
    }
    if (selectedItem.status !== 'Available' || isExpired(selectedItem.expiryDate)) {
      setBuyErr('Voucher này vừa được giữ chỗ hoặc đã hết hạn. Vui lòng chọn voucher khác.');
      return;
    }
    const now = new Date().toISOString();
    const order: BuyOrder = {
      id: uid('ord'),
      orderCode: genCode('ORD'),
      customerName: buyName.trim(),
      customerPhone: buyPhone.trim(),
      customerEmail: buyEmail.trim() || undefined,
      inventoryItemIds: [selectedItem.id],
      brandId: selectedItem.brandId,
      faceValue: selectedItem.faceValue,
      quantity: 1,
      totalAmount: selectedItem.sellPrice,
      status: 'Pending Payment',
      createdAt: now,
      updatedAt: now,
    };
    await updateStore((d) => {
      const inv = d.inventory.find((x) => x.id === selectedItem.id);
      if (!inv || inv.status !== 'Available') return;
      inv.status = 'Reserved';
      inv.reservedByOrderId = order.id;
      inv.updatedAt = now;
      d.buyOrders.unshift(order);
    });
    setActiveOrder(order);
  };

  const handleConfirmOrderTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    await updateStore((d) => {
      const o = d.buyOrders.find((x) => x.id === activeOrder.id);
      if (!o || o.status !== 'Pending Payment') return;
      o.transferReference = buyTransferRef.trim();
      o.status = 'Payment Submitted';
      o.updatedAt = new Date().toISOString();
      setActiveOrder({ ...o });
    });
    setBuyMsg('Đã gửi mã tham chiếu chuyển khoản. Admin sẽ xác nhận tiền và giao mã qua mục Tra cứu đơn.');
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setLookupErr('');
    setLookupMsg('');
    const c = lookupCode.trim().toUpperCase();
    const p = lookupPhone.trim();
    if (c.startsWith('SELL-')) {
      const found = store.sellRequests.find((r) => r.requestCode.toUpperCase() === c && r.customerPhone === p);
      if (!found) {
        setLookupResult(null);
        setLookupErr('Không tìm thấy yêu cầu thu mua khớp với mã và số điện thoại.');
        return;
      }
      setLookupResult({ kind: 'sell', id: found.id });
    } else if (c.startsWith('ORD-')) {
      const found = store.buyOrders.find((o) => o.orderCode.toUpperCase() === c && o.customerPhone === p);
      if (!found) {
        setLookupResult(null);
        setLookupErr('Không tìm thấy đơn mua khớp với mã và số điện thoại.');
        return;
      }
      setLookupResult({ kind: 'buy', id: found.id });
    } else {
      setLookupErr('Mã đơn phải bắt đầu bằng SELL- hoặc ORD-');
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminAuthErr('');
    if (adminPass.length < 6) {
      setAdminAuthErr('Passcode tối thiểu 6 ký tự.');
      return;
    }
    const h = await sha256Hex(`${adminUser.trim()}::${adminPass}`);
    const saved = localStorage.getItem(ADMIN_HASH_KEY);
    if (!saved) {
      localStorage.setItem(ADMIN_HASH_KEY, h);
    } else if (saved !== h) {
      setAdminAuthErr('Sai email hoặc Passcode Demo bạn đã đặt trước đó trên trình duyệt này.');
      return;
    }
    setAdminLoggedIn(true);
    setAdminPass('');
  };

  const adminAct = async (fn: (d: StoreState) => string | void, successMsg: string) => {
    setAdminErr('');
    setAdminMsg('');
    try {
      let errText = '';
      await updateStore((d) => {
        const res = fn(d);
        if (typeof res === 'string') errText = res;
      });
      if (errText.length > 0) {
        setAdminErr(errText);
      } else {
        setAdminMsg(successMsg);
      }
    } catch (err: any) {
      setAdminErr(err?.message || 'Thao tác thất bại');
    }
  };

  const lookedSell = lookupResult?.kind === 'sell' ? store.sellRequests.find((s) => s.id === lookupResult.id) : null;
  const lookedBuy = lookupResult?.kind === 'buy' ? store.buyOrders.find((b) => b.id === lookupResult.id) : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <div className="bg-blue-700 text-white text-center text-xs py-1.5 px-3">
        Chế độ Demo IndexedDB (Sandbox): Không lưu mã voucher thật • Không dùng mật khẩu mặc định • Thanh toán thủ công giả lập
      </div>

      <header className="sticky top-0 z-40 bg-[#0B1F3A] text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setPage('home')} className="flex items-center gap-2.5 text-left">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-lg">VX</div>
            <div>
              <div className="font-bold tracking-wide text-base">VOUCHER EXCHANGE</div>
              <div className="text-[11px] text-blue-200">Thu mua & Phân phối E-Voucher bảo chứng</div>
            </div>
          </button>

          <nav className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['home', 'Trang chủ'],
                ['vouchers', 'Mua Voucher'],
                ['sell', 'Bán Voucher'],
                ['lookup', 'Tra cứu đơn'],
                ['guide', 'Hướng dẫn'],
                ['policy', 'Chính sách'],
                ['contact', 'Liên hệ'],
              ] as [PageKey, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPage(k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${page === k ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-white/10'}`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setPage('admin')}
              className={`ml-2 px-3 py-1.5 rounded-lg text-sm font-semibold border ${page === 'admin' ? 'bg-white text-[#0B1F3A] border-white' : 'border-blue-400/50 text-blue-200 hover:bg-blue-600/30'}`}
            >
              Admin Portal
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {page === 'home' && (
          <div className="space-y-8">
            <section className="rounded-2xl bg-gradient-to-br from-[#0B1F3A] via-[#102A4C] to-blue-700 text-white p-8 md:p-12 shadow-lg">
              <div className="max-w-3xl space-y-4">
                <span className="inline-block px-3 py-1 rounded-full bg-blue-500/30 border border-blue-300/30 text-xs font-semibold">
                  Buy & Resell Fintech Marketplace
                </span>
                <h1 className="text-3xl md:text-4xl font-bold leading-tight">
                  Thu mua & Giao dịch E-Voucher, Gift Card An Toàn – Minh Bạch Giá
                </h1>
                <p className="text-blue-100">
                  Khách không tự đăng bán. Mọi voucher được Admin thẩm định, nhập kho và bảo vệ mã trước khi giao dịch.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button onClick={() => setPage('sell')} className="px-5 py-2.5 rounded-xl bg-white text-[#0B1F3A] font-semibold hover:bg-blue-50">
                    Gửi yêu cầu bán Voucher
                  </button>
                  <button onClick={() => setPage('vouchers')} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold border border-blue-400 hover:bg-blue-500">
                    Mua Voucher sẵn kho ({availableItems.length})
                  </button>
                </div>
              </div>
            </section>

            <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableItems.map((item) => {
                const b = store.brands.find((x) => x.id === item.brandId);
                const savePct = Math.round(((item.faceValue - item.sellPrice) / item.faceValue) * 100);
                return (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase text-blue-700">{b?.name}</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Tiết kiệm {savePct}%</span>
                      </div>
                      <div className="text-lg font-bold text-[#0B1F3A]">Mệnh giá {formatVND(item.faceValue)}</div>
                      <div className="text-xs text-slate-500 mt-1">{item.voucherType} • HSD: {formatDateVN(item.expiryDate)}</div>
                    </div>
                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div className="text-lg font-bold text-blue-700">{formatVND(item.sellPrice)}</div>
                      <button
                        onClick={() => { setSelectedItemId(item.id); setActiveOrder(null); setBuyMsg(''); setBuyErr(''); setPage('detail'); }}
                        className="px-4 py-2 rounded-lg bg-[#0B1F3A] text-white text-sm font-semibold hover:bg-blue-700"
                      >
                        Chi tiết & Mua
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        )}

        {page === 'vouchers' && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border p-4 grid md:grid-cols-4 gap-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm thương hiệu hoặc mệnh giá..." className="md:col-span-2 px-3 py-2 border rounded-lg text-sm" />
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="ALL">Tất cả thương hiệu</option>
                {store.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="ALL">Tất cả loại</option>
                <option value="e-voucher">E-Voucher</option>
                <option value="gift-card">Gift Card</option>
                <option value="physical">Voucher giấy</option>
              </select>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const b = store.brands.find((x) => x.id === item.brandId);
                return (
                  <div key={item.id} className="bg-white rounded-xl border p-5 flex flex-col justify-between shadow-sm">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-blue-700 text-sm">{b?.name}</span>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="text-lg font-bold text-[#0B1F3A]">{formatVND(item.faceValue)}</div>
                      <p className="text-xs text-slate-500 mt-1">Mã kho: {item.maskedCode} • HSD: {formatDateVN(item.expiryDate)}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t pt-3">
                      <span className="font-bold text-lg text-blue-700">{formatVND(item.sellPrice)}</span>
                      <button
                        onClick={() => { setSelectedItemId(item.id); setActiveOrder(null); setBuyMsg(''); setBuyErr(''); setPage('detail'); }}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                      >
                        Đặt mua
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {page === 'detail' && selectedItem && (
          <div className="space-y-4">
            <button onClick={() => setPage('vouchers')} className="text-sm font-semibold text-blue-700 hover:underline">← Quay lại danh sách</button>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border p-6 space-y-3">
                <span className="text-xs font-bold uppercase text-blue-700">{store.brands.find((b) => b.id === selectedItem.brandId)?.name}</span>
                <h1 className="text-2xl font-bold text-[#0B1F3A]">Voucher mệnh giá {formatVND(selectedItem.faceValue)}</h1>
                <div className="text-3xl font-bold text-blue-700">{formatVND(selectedItem.sellPrice)}</div>
                <ul className="text-sm text-slate-600 space-y-1.5 pt-2 border-t">
                  <li>• Loại: {selectedItem.voucherType}</li>
                  <li>• Hạn sử dụng: <strong>{formatDateVN(selectedItem.expiryDate)}</strong></li>
                  <li>• Mã hiển thị công khai: {selectedItem.maskedCode}</li>
                  <li>• Chỉ giao mã sau khi Admin xác nhận chuyển khoản & voucher vẫn hợp lệ.</li>
                </ul>
              </div>
              <div className="bg-white rounded-xl border p-6">
                {!activeOrder ? (
                  <form onSubmit={handlePlaceOrder} className="space-y-3">
                    <h2 className="text-lg font-bold text-[#0B1F3A]">Đặt mua & Giữ chỗ chống bán trùng</h2>
                    {buyErr && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{buyErr}</div>}
                    <input required value={buyName} onChange={(e) => setBuyName(e.target.value)} placeholder="Họ và tên *" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input required value={buyPhone} onChange={(e) => setBuyPhone(e.target.value)} placeholder="Số điện thoại nhận mã (09xxxxxxxx) *" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input type="email" value={buyEmail} onChange={(e) => setBuyEmail(e.target.value)} placeholder="Email (tùy chọn)" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <button className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                      Đặt mua ({formatVND(selectedItem.sellPrice)})
                    </button>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-[#0B1F3A]">Đơn {activeOrder.orderCode}</h2>
                      <StatusBadge status={activeOrder.status} />
                    </div>
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm space-y-1">
                      <div className="font-bold">Chuyển khoản thủ công (Demo)</div>
                      <div>STK: <strong>0071000888999 - Vietcombank</strong></div>
                      <div>Số tiền: <strong className="text-blue-700">{formatVND(activeOrder.totalAmount)}</strong></div>
                      <div>Nội dung CK: <strong className="text-rose-600">{activeOrder.orderCode}</strong></div>
                    </div>
                    {buyMsg ? (
                      <div className="p-3 rounded bg-emerald-50 text-emerald-800 text-sm">{buyMsg}</div>
                    ) : (
                      <form onSubmit={handleConfirmOrderTransfer} className="space-y-2">
                        <input required value={buyTransferRef} onChange={(e) => setBuyTransferRef(e.target.value)} placeholder="Mã giao dịch chuyển khoản (VD: FT123456)" className="w-full px-3 py-2 border rounded-lg text-sm" />
                        <button className="w-full py-2 rounded-lg bg-[#0B1F3A] text-white text-sm font-semibold">Gửi xác nhận đã chuyển khoản</button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {page === 'sell' && (
          sellCreated ? (
            <div className="max-w-2xl mx-auto bg-white rounded-2xl border p-6 space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="text-xs font-semibold text-emerald-700">ĐÃ TIẾP NHẬN YÊU CẦU THU MUA</div>
                <div className="text-2xl font-bold text-[#0B1F3A] mt-1">Mã yêu cầu: {sellCreated.requestCode}</div>
                <p className="text-sm text-slate-600 mt-1">Trạng thái: <strong>{sellCreated.status}</strong>. Giá dự kiến: <strong>{formatVND(sellCreated.estimatedUnitBuyPrice * sellCreated.quantity)}</strong>.</p>
              </div>
              <button onClick={() => setSellCreated(null)} className="px-4 py-2 rounded-lg bg-[#0B1F3A] text-white text-sm font-semibold">Gửi thêm yêu cầu khác</button>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto grid md:grid-cols-3 gap-6">
              <form onSubmit={handleCreateSell} className="md:col-span-2 bg-white rounded-2xl border p-6 space-y-4">
                <h1 className="text-xl font-bold text-[#0B1F3A]">Đề nghị Bán Voucher cho Sàn</h1>
                {sellErr && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{sellErr}</div>}
                <div className="grid sm:grid-cols-2 gap-3">
                  <input required value={sellName} onChange={(e) => setSellName(e.target.value)} placeholder="Họ và tên *" className="px-3 py-2 border rounded-lg text-sm" />
                  <input required value={sellPhone} onChange={(e) => setSellPhone(e.target.value)} placeholder="Số điện thoại (09xxxxxxxx) *" className="px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input type="email" value={sellEmail} onChange={(e) => setSellEmail(e.target.value)} placeholder="Email (tùy chọn)" className="px-3 py-2 border rounded-lg text-sm" />
                  <select value={sellBrand} onChange={(e) => setSellBrand(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                    {store.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <select value={sellType} onChange={(e) => setSellType(e.target.value as VoucherType)} className="px-3 py-2 border rounded-lg text-sm">
                    <option value="e-voucher">E-Voucher</option>
                    <option value="gift-card">Gift Card</option>
                    <option value="physical">Voucher giấy</option>
                  </select>
                  <input type="number" min={50000} step={10000} required value={sellFace} onChange={(e) => setSellFace(Number(e.target.value))} className="px-3 py-2 border rounded-lg text-sm" />
                  <input type="number" min={1} max={20} required value={sellQty} onChange={(e) => setSellQty(Number(e.target.value))} className="px-3 py-2 border rounded-lg text-sm" />
                </div>
                <input type="date" required value={sellExpiry} onChange={(e) => setSellExpiry(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <textarea required rows={2} value={sellNote} onChange={(e) => setSellNote(e.target.value)} placeholder="Thông tin voucher (Không nhập mã bí mật đầy đủ tại đây) *" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <input required value={sellEvidence} onChange={(e) => setSellEvidence(e.target.value)} placeholder="Mô tả / Link ảnh minh họa *" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <button className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700">Gửi yêu cầu thu mua</button>
              </form>
              <aside className="bg-[#0B1F3A] text-white rounded-2xl p-6 space-y-3 h-fit">
                <div className="text-xs uppercase text-blue-300 font-semibold">Định giá dự kiến</div>
                <div className="text-sm flex justify-between"><span>Mệnh giá:</span><span>{formatVND(sellFace)}</span></div>
                <div className="text-sm flex justify-between"><span>Tỷ lệ:</span><span>{Math.round(estimatedSell.rate * 100)}%</span></div>
                <div className="border-t border-white/20 pt-2 flex justify-between font-bold">
                  <span>Tổng dự kiến ({sellQty}):</span>
                  <span className="text-blue-300">{formatVND(estimatedSell.total)}</span>
                </div>
                <p className="text-xs text-slate-300">* Admin sẽ duyệt giá thu mua cuối cùng.</p>
              </aside>
            </div>
          )
        )}

        {page === 'lookup' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <form onSubmit={handleLookup} className="bg-white rounded-2xl border p-6 space-y-4">
              <h1 className="text-xl font-bold text-[#0B1F3A]">Tra cứu Yêu cầu Bán & Đơn Mua</h1>
              <p className="text-xs text-slate-500">Thử nhanh với dữ liệu mẫu: <code>SELL-20261123-0001</code> / <code>0901234567</code> hoặc <code>ORD-20261123-0001</code> / <code>0912345678</code></p>
              {lookupErr && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{lookupErr}</div>}
              {lookupMsg && <div className="p-3 rounded bg-emerald-50 text-emerald-800 text-sm">{lookupMsg}</div>}
              <div className="grid sm:grid-cols-3 gap-3">
                <input required value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} placeholder="Mã SELL-... hoặc ORD-..." className="px-3 py-2 border rounded-lg text-sm" />
                <input required value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} placeholder="Số điện thoại" className="px-3 py-2 border rounded-lg text-sm" />
                <button className="px-4 py-2 rounded-lg bg-[#0B1F3A] text-white text-sm font-semibold">Tra cứu</button>
              </div>
            </form>

            {lookedSell && (
              <div className="bg-white rounded-2xl border p-6 space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold text-[#0B1F3A]">{lookedSell.requestCode}</h2>
                  <StatusBadge status={lookedSell.status} />
                </div>
                <div className="text-sm text-slate-700 space-y-1">
                  <div>Mệnh giá: <strong>{formatVND(lookedSell.faceValue)}</strong> × {lookedSell.quantity}</div>
                  <div>Giá dự kiến: {formatVND(lookedSell.estimatedUnitBuyPrice * lookedSell.quantity)}</div>
                  <div>Giá Admin báo cuối: <strong className="text-blue-700">{lookedSell.finalTotalBuyPrice ? formatVND(lookedSell.finalTotalBuyPrice) : 'Chờ báo giá'}</strong></div>
                  {lookedSell.payoutReference && <div className="text-emerald-700">Mã CK chi trả: <strong>{lookedSell.payoutReference}</strong></div>}
                </div>
                {lookedSell.status === 'Quoted' && (
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => updateStore((d) => { const r = d.sellRequests.find((x) => x.id === lookedSell.id); if (r) { r.status = 'Accepted'; r.updatedAt = new Date().toISOString(); } }).then(() => setLookupMsg('Bạn đã đồng ý mức giá!'))}
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
                    >
                      Đồng ý mức giá
                    </button>
                    <button
                      onClick={() => updateStore((d) => { const r = d.sellRequests.find((x) => x.id === lookedSell.id); if (r) { r.status = 'Rejected'; r.rejectionReason = 'Khách từ chối giá'; } }).then(() => setLookupMsg('Đã từ chối báo giá.'))}
                      className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold"
                    >
                      Từ chối
                    </button>
                  </div>
                )}
              </div>
            )}

            {lookedBuy && (
              <div className="bg-white rounded-2xl border p-6 space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-bold text-[#0B1F3A]">{lookedBuy.orderCode}</h2>
                  <StatusBadge status={lookedBuy.status} />
                </div>
                <div className="text-sm">Tổng thanh toán: <strong className="text-blue-700">{formatVND(lookedBuy.totalAmount)}</strong> • Mã CK: <strong>{lookedBuy.transferReference ?? 'Chưa gửi'}</strong></div>
                {lookedBuy.status === 'Pending Payment' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateStore((d) => { const o = d.buyOrders.find((x) => x.id === lookedBuy.id); if (o) { o.transferReference = lookupTransferRef; o.status = 'Payment Submitted'; } }).then(() => setLookupMsg('Đã gửi xác nhận CK.'));
                    }}
                    className="flex gap-2"
                  >
                    <input required value={lookupTransferRef} onChange={(e) => setLookupTransferRef(e.target.value)} placeholder="Mã giao dịch chuyển khoản" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                    <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">Xác nhận CK</button>
                  </form>
                )}
                {lookedBuy.status === 'Delivered' && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1">
                    <div className="font-bold text-emerald-900 text-sm">Voucher đã giao (Demo Token):</div>
                    {lookedBuy.deliveredDemoVoucherTokens?.map((t, idx) => <div key={idx} className="font-mono text-sm bg-white p-2 rounded border">{t}</div>)}
                  </div>
                )}
              </div>
            )}

            {(lookedSell || lookedBuy) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const targetCode = lookedSell ? lookedSell.requestCode : lookedBuy!.orderCode;
                  updateStore((d) => {
                    d.disputes.unshift({ id: uid('dsp'), ticketCode: genCode('TKT'), orderOrRequestCode: targetCode, customerPhone: lookupPhone, reason: disputeReason, status: 'Open', createdAt: new Date().toISOString() });
                  }).then(() => { setDisputeReason(''); setLookupMsg('Đã gửi phiếu khiếu nại tới Admin.'); });
                }}
                className="bg-white rounded-2xl border p-5 flex gap-2"
              >
                <input required value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Cần hỗ trợ / khiếu nại cho đơn này..." className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                <button className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold">Gửi phiếu</button>
              </form>
            )}
          </div>
        )}

        {(page === 'guide' || page === 'policy' || page === 'contact') && (
          <div className="bg-white rounded-xl border p-6 space-y-3 text-sm text-slate-700">
            <h1 className="text-2xl font-bold text-[#0B1F3A]">
              {page === 'guide' ? 'Hướng dẫn Giao dịch' : page === 'policy' ? 'Chính sách Bảo mật & Đối soát' : 'Liên hệ Hỗ trợ'}
            </h1>
            {page === 'guide' && <p>Bán voucher: Gửi yêu cầu → Admin báo giá → Khách xác nhận → Admin thanh toán → Nhập kho. Mua voucher: Đặt giữ chỗ → Chuyển khoản thủ công → Admin xác nhận tiền & giao mã.</p>}
            {page === 'policy' && <p>Khách không tự niêm yết. Mọi voucher được kiểm duyệt bởi Admin và chống bán trùng tại bước giữ chỗ. Bản Production mã hóa mã thật bằng AES-256-GCM phía máy chủ.</p>}
            {page === 'contact' && <p>Email: support@voucherexchange.vn • Hotline: 1900 6868 (08:30 – 21:00).</p>}
          </div>
        )}

        {page === 'admin' && (
          !adminLoggedIn ? (
            <div className="max-w-md mx-auto bg-white rounded-2xl border p-6 space-y-4">
              <h1 className="text-xl font-bold text-[#0B1F3A]">Đăng nhập Admin Portal (Sandbox)</h1>
              <p className="text-xs text-slate-500">Không có mật khẩu mặc định. Lần đầu đăng nhập trên trình duyệt này, bạn nhập email & tự đặt Passcode (&ge; 6 ký tự) để khóa phiên Demo.</p>
              {adminAuthErr && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{adminAuthErr}</div>}
              <form onSubmit={handleAdminLogin} className="space-y-3">
                <input required value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder="Email Admin (VD: admin@voucher.vn)" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <input required type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="Passcode (>= 6 ký tự)" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <button className="w-full py-2.5 rounded-lg bg-[#0B1F3A] text-white font-semibold hover:bg-blue-700">Vào trang quản trị</button>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-white p-4 rounded-xl border flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['dashboard', 'Báo cáo'],
                      ['buyback', `Thu mua (${store.sellRequests.length})`],
                      ['inventory', `Kho (${store.inventory.length})`],
                      ['orders', `Đơn bán (${store.buyOrders.length})`],
                      ['pricing', 'Tỷ lệ giá'],
                      ['disputes', `Khiếu nại (${store.disputes.length})`],
                      ['logs', `Nhật ký (${store.auditLogs.length})`],
                    ] as [AdminTab, string][]
                  ).map(([k, lbl]) => (
                    <button key={k} onClick={() => setAdminTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${adminTab === k ? 'bg-[#0B1F3A] text-white' : 'bg-slate-100 text-slate-700'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => { const s = createSeedState(); setStore(s); idbSave(s); setAdminMsg('Đã khôi phục dữ liệu mẫu ban đầu'); }} className="text-blue-700 font-semibold hover:underline">Reset Demo</button>
                  <button onClick={() => setAdminLoggedIn(false)} className="text-rose-600 font-semibold hover:underline">Đăng xuất</button>
                </div>
              </div>

              {adminMsg && <div className="p-3 rounded bg-emerald-50 text-emerald-800 text-sm">{adminMsg}</div>}
              {adminErr && <div className="p-3 rounded bg-rose-50 text-rose-700 text-sm">{adminErr}</div>}

              {adminTab === 'dashboard' && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded-xl border"><div className="text-xs text-slate-500">Doanh thu bán</div><div className="text-xl font-bold text-blue-700">{formatVND(report.grossRevenue)}</div></div>
                  <div className="bg-white p-4 rounded-xl border"><div className="text-xs text-slate-500">Giá vốn đã bán</div><div className="text-xl font-bold">{formatVND(report.soldCogs)}</div></div>
                  <div className="bg-white p-4 rounded-xl border"><div className="text-xs text-slate-500">Lợi nhuận gộp</div><div className="text-xl font-bold text-emerald-700">{formatVND(report.grossProfit)}</div></div>
                  <div className="bg-white p-4 rounded-xl border"><div className="text-xs text-slate-500">Tồn kho giá vốn (Không tính DT)</div><div className="text-xl font-bold text-[#0B1F3A]">{formatVND(report.unsoldCost)}</div></div>
                  <div className="bg-white p-4 rounded-xl border text-sm">Chi thu mua đã trả: <strong>{formatVND(report.buybackPaid)}</strong></div>
                  <div className="bg-white p-4 rounded-xl border text-sm">Available / Reserved / Sold: <strong>{report.availableCount} / {report.reservedCount} / {report.soldCount}</strong></div>
                  <div className="bg-white p-4 rounded-xl border text-sm text-amber-700">Sắp hết hạn (&le;14 ngày): <strong>{report.expiringSoonCount}</strong></div>
                </div>
              )}

              {adminTab === 'buyback' && (
                <div className="space-y-3">
                  {store.sellRequests.map((s) => (
                    <div key={s.id} className="bg-white p-4 rounded-xl border space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="text-sm"><strong>{s.requestCode}</strong> • {s.customerName} ({s.customerPhone}) • {formatVND(s.faceValue)} × {s.quantity}</div>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {(s.status === 'Pending' || s.status === 'Reviewing') && (
                          <>
                            <input type="number" value={quoteInputs[s.id] ?? s.estimatedUnitBuyPrice} onChange={(e) => setQuoteInputs({ ...quoteInputs, [s.id]: Number(e.target.value) })} className="px-2 py-1 border rounded w-28" />
                            <button onClick={() => adminAct((d) => { const r = d.sellRequests.find((x) => x.id === s.id)!; const p = quoteInputs[s.id] ?? s.estimatedUnitBuyPrice; r.finalUnitBuyPrice = p; r.finalTotalBuyPrice = p * r.quantity; r.status = 'Quoted'; d.auditLogs.unshift({ id: uid('log'), actor: adminUser, action: 'QUOTED', summary: `Báo giá ${r.requestCode}: ${formatVND(p)}`, createdAt: new Date().toISOString() }); }, 'Đã gửi báo giá')} className="px-3 py-1.5 rounded bg-blue-600 text-white font-semibold">Báo giá (Quoted)</button>
                          </>
                        )}
                        {s.status === 'Accepted' && (
                          <button onClick={() => adminAct((d) => { d.sellRequests.find((x) => x.id === s.id)!.status = 'Verified'; }, 'Đã xác minh voucher')} className="px-3 py-1.5 rounded bg-cyan-700 text-white font-semibold">Xác minh (Verified)</button>
                        )}
                        {s.status === 'Verified' && (
                          <button onClick={() => adminAct((d) => { d.sellRequests.find((x) => x.id === s.id)!.status = 'Awaiting Payment'; }, 'Chuyển chờ thanh toán')} className="px-3 py-1.5 rounded bg-orange-600 text-white font-semibold">Chờ chi trả</button>
                        )}
                        {s.status === 'Awaiting Payment' && (
                          <>
                            <input placeholder="Mã CK chi trả" value={payoutInputs[s.id] ?? ''} onChange={(e) => setPayoutInputs({ ...payoutInputs, [s.id]: e.target.value })} className="px-2 py-1 border rounded w-36" />
                            <button onClick={() => adminAct((d) => { if (!payoutInputs[s.id]?.trim()) return 'Cần nhập mã CK chi trả'; const r = d.sellRequests.find((x) => x.id === s.id)!; r.payoutReference = payoutInputs[s.id]; r.status = 'Paid'; }, 'Đã xác nhận thanh toán cho khách')} className="px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold">Xác nhận Paid</button>
                          </>
                        )}
                        {s.status === 'Paid' && (
                          <>
                            <input type="number" value={stockSellPrices[s.id] ?? Math.round(s.faceValue * 0.92)} onChange={(e) => setStockSellPrices({ ...stockSellPrices, [s.id]: Number(e.target.value) })} className="px-2 py-1 border rounded w-28" />
                            <input placeholder={`Nhập ${s.quantity} mã tham chiếu (dấu ,)`} value={stockCodes[s.id] ?? ''} onChange={(e) => setStockCodes({ ...stockCodes, [s.id]: e.target.value })} className="px-2 py-1 border rounded w-56" />
                            <button
                              onClick={() =>
                                adminAct((d) => {
                                  const codes = (stockCodes[s.id] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
                                  if (codes.length !== s.quantity) return `Cần nhập đúng ${s.quantity} mã tham chiếu`;
                                  const r = d.sellRequests.find((x) => x.id === s.id)!;
                                  const cost = r.finalUnitBuyPrice ?? r.estimatedUnitBuyPrice;
                                  const sellP = stockSellPrices[s.id] ?? Math.round(r.faceValue * 0.92);
                                  const now = new Date().toISOString();
                                  codes.forEach((c) => d.inventory.unshift({ id: uid('inv'), sourceSellRequestId: r.id, brandId: r.brandId, voucherType: r.voucherType, faceValue: r.faceValue, costPrice: cost, sellPrice: sellP, expiryDate: r.expiryDate, maskedCode: maskCode(c), demoFulfillmentToken: `DEMO-TOKEN-${c.slice(-6).toUpperCase()}`, status: 'Available', stockedAt: now, updatedAt: now }));
                                  r.status = 'Stocked';
                                  d.auditLogs.unshift({ id: uid('log'), actor: adminUser, action: 'STOCKED', summary: `Nhập kho ${codes.length} voucher từ ${r.requestCode}`, createdAt: now });
                                }, 'Đã nhập kho thành công!')
                              }
                              className="px-3 py-1.5 rounded bg-[#0B1F3A] text-white font-semibold"
                            >
                              Nhập kho (Stocked)
                            </button>
                          </>
                        )}
                        {SELL_TRANSITIONS[s.status].includes('Rejected') && (
                          <button onClick={() => adminAct((d) => { d.sellRequests.find((x) => x.id === s.id)!.status = 'Rejected'; }, 'Đã từ chối')} className="px-3 py-1.5 rounded bg-rose-100 text-rose-700 font-semibold">Từ chối</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {adminTab === 'inventory' && (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border space-y-2">
                    <div className="text-sm font-bold text-[#0B1F3A]">Admin thêm trực tiếp vào kho</div>
                    <div className="grid sm:grid-cols-6 gap-2 text-xs">
                      <select value={newInvBrand} onChange={(e) => setNewInvBrand(e.target.value)} className="px-2 py-2 border rounded">{store.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                      <input type="number" value={newInvFace} onChange={(e) => setNewInvFace(Number(e.target.value))} className="px-2 py-2 border rounded" />
                      <input type="number" value={newInvCost} onChange={(e) => setNewInvCost(Number(e.target.value))} className="px-2 py-2 border rounded" />
                      <input type="number" value={newInvSell} onChange={(e) => setNewInvSell(Number(e.target.value))} className="px-2 py-2 border rounded" />
                      <input type="date" value={newInvExpiry} onChange={(e) => setNewInvExpiry(e.target.value)} className="px-2 py-2 border rounded" />
                      <input value={newInvCode} onChange={(e) => setNewInvCode(e.target.value)} placeholder="Mã tham chiếu" className="px-2 py-2 border rounded" />
                    </div>
                    <button onClick={() => adminAct((d) => { const c = newInvCode || 'DEMO-9999'; const now = new Date().toISOString(); d.inventory.unshift({ id: uid('inv'), brandId: newInvBrand, voucherType: 'e-voucher', faceValue: newInvFace, costPrice: newInvCost, sellPrice: newInvSell, expiryDate: newInvExpiry, maskedCode: maskCode(c), demoFulfillmentToken: `DEMO-TOKEN-${c.slice(-6).toUpperCase()}`, status: 'Available', stockedAt: now, updatedAt: now }); }, 'Đã thêm vào kho')} className="px-4 py-2 rounded bg-[#0B1F3A] text-white text-xs font-semibold">+ Thêm kho Available</button>
                  </div>

                  <div className="bg-white rounded-xl border overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b"><tr><th className="p-3">Mã che</th><th className="p-3">Thương hiệu</th><th className="p-3">Mệnh giá</th><th className="p-3">Vốn / Bán</th><th className="p-3">HSD</th><th className="p-3">Trạng thái</th><th className="p-3">Thao tác</th></tr></thead>
                      <tbody>
                        {store.inventory.map((i) => (
                          <tr key={i.id} className="border-b">
                            <td className="p-3 font-mono">{i.maskedCode}</td>
                            <td className="p-3">{store.brands.find((b) => b.id === i.brandId)?.name}</td>
                            <td className="p-3">{formatVND(i.faceValue)}</td>
                            <td className="p-3">{formatVND(i.costPrice)} / <strong className="text-blue-700">{formatVND(i.sellPrice)}</strong></td>
                            <td className="p-3">{formatDateVN(i.expiryDate)}</td>
                            <td className="p-3"><StatusBadge status={i.status} /></td>
                            <td className="p-3">
                              {INVENTORY_TRANSITIONS[i.status].includes('Locked') && i.status === 'Available' && (
                                <button onClick={() => adminAct((d) => { d.inventory.find((x) => x.id === i.id)!.status = 'Locked'; }, 'Đã khóa')} className="text-rose-600 font-semibold">Khóa</button>
                              )}
                              {i.status === 'Locked' && (
                                <button onClick={() => adminAct((d) => { d.inventory.find((x) => x.id === i.id)!.status = 'Available'; }, 'Đã mở khóa')} className="text-emerald-600 font-semibold">Mở</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {adminTab === 'orders' && (
                <div className="space-y-3">
                  {store.buyOrders.map((o) => (
                    <div key={o.id} className="bg-white p-4 rounded-xl border flex flex-wrap justify-between items-center gap-3">
                      <div className="text-sm">
                        <strong>{o.orderCode}</strong> • {o.customerName} ({o.customerPhone}) • <strong>{formatVND(o.totalAmount)}</strong> • CK: {o.transferReference ?? 'Chưa có'}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={o.status} />
                        {(o.status === 'Pending Payment' || o.status === 'Payment Submitted') && (
                          <>
                            <button
                              onClick={() =>
                                adminAct((d) => {
                                  const ord = d.buyOrders.find((x) => x.id === o.id)!;
                                  const tokens: string[] = [];
                                  for (const id of ord.inventoryItemIds) {
                                    const inv = d.inventory.find((x) => x.id === id);
                                    if (!inv || inv.status !== 'Reserved' || isExpired(inv.expiryDate)) return 'Voucher không còn hợp lệ để giao';
                                    inv.status = 'Sold';
                                    tokens.push(inv.demoFulfillmentToken);
                                  }
                                  ord.status = 'Delivered';
                                  ord.deliveredDemoVoucherTokens = tokens;
                                  d.auditLogs.unshift({ id: uid('log'), actor: adminUser, action: 'DELIVER', summary: `Xác nhận tiền & giao mã ${ord.orderCode}`, createdAt: new Date().toISOString() });
                                }, `Đã giao mã cho đơn ${o.orderCode}`)
                              }
                              className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold"
                            >
                              Xác nhận tiền & Giao mã
                            </button>
                            <button
                              onClick={() =>
                                adminAct((d) => {
                                  const ord = d.buyOrders.find((x) => x.id === o.id)!;
                                  ord.inventoryItemIds.forEach((id) => { const inv = d.inventory.find((x) => x.id === id); if (inv) { inv.status = 'Available'; inv.reservedByOrderId = undefined; } });
                                  ord.status = 'Cancelled';
                                }, 'Đã hủy đơn & hoàn kho')
                              }
                              className="px-3 py-1.5 rounded bg-rose-100 text-rose-700 text-xs font-semibold"
                            >
                              Hủy & Nhả kho
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {adminTab === 'pricing' && (
                <div className="bg-white p-4 rounded-xl border space-y-4">
                  <div className="grid sm:grid-cols-5 gap-2 text-xs">
                    <select value={ruleBrand} onChange={(e) => setRuleBrand(e.target.value)} className="px-2 py-2 border rounded">{store.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                    <input type="number" value={ruleFace} onChange={(e) => setRuleFace(Number(e.target.value))} placeholder="Mệnh giá" className="px-2 py-2 border rounded" />
                    <input type="number" step="0.01" value={ruleRate} onChange={(e) => setRuleRate(Number(e.target.value))} placeholder="Tỷ lệ (0.85)" className="px-2 py-2 border rounded" />
                    <input type="number" value={ruleSell} onChange={(e) => setRuleSell(Number(e.target.value))} placeholder="Giá bán" className="px-2 py-2 border rounded" />
                    <button onClick={() => adminAct((d) => { d.pricingRules.unshift({ id: uid('pr'), brandId: ruleBrand, voucherType: 'e-voucher', faceValue: ruleFace, buybackRate: ruleRate, defaultSellPrice: ruleSell, active: true }); }, 'Đã thêm cấu hình giá')} className="px-3 py-2 rounded bg-blue-600 text-white font-semibold">+ Thêm cấu hình</button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-xs">
                    {store.pricingRules.map((pr) => (
                      <div key={pr.id} className="p-3 border rounded-lg">
                        <div className="font-bold">{store.brands.find((b) => b.id === pr.brandId)?.name} ({pr.voucherType})</div>
                        <div>Mệnh giá: {formatVND(pr.faceValue)} • Thu: {Math.round(pr.buybackRate * 100)}% • Bán: {formatVND(pr.defaultSellPrice)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminTab === 'disputes' && (
                <div className="space-y-2">
                  {store.disputes.length === 0 ? <div className="bg-white p-5 rounded-xl border text-sm text-slate-500">Chưa có khiếu nại.</div> : store.disputes.map((t) => (
                    <div key={t.id} className="bg-white p-4 rounded-xl border flex justify-between items-center text-sm">
                      <div><strong>{t.ticketCode}</strong> ({t.orderOrRequestCode}) — {t.reason}</div>
                      {t.status !== 'Resolved' ? (
                        <button onClick={() => adminAct((d) => { d.disputes.find((x) => x.id === t.id)!.status = 'Resolved'; }, 'Đã xử lý khiếu nại')} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold">Xong</button>
                      ) : <StatusBadge status="Resolved" />}
                    </div>
                  ))}
                </div>
              )}

              {adminTab === 'logs' && (
                <div className="bg-white rounded-xl border divide-y text-xs">
                  {store.auditLogs.map((l) => (
                    <div key={l.id} className="p-3 flex justify-between">
                      <span><strong>{l.action}</strong> — {l.summary}</span>
                      <span className="text-slate-400">{l.actor} • {new Date(l.createdAt).toLocaleString('vi-VN')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </main>

      <footer className="bg-[#0B1F3A] text-slate-300 text-xs py-6 mt-12 text-center">
        VOUCHER EXCHANGE MVP • Dữ liệu thử nghiệm lưu trên IndexedDB của trình duyệt
      </footer>
    </div>
  );
}

export default App;
