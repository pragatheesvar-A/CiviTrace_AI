// Civic Services & Payments — Razorpay TEST / sandbox (or simulated when no keys).
// Completely separate from civic complaints. Normal complaints are always free.
import React, { useEffect, useState } from "react";
import { useAuth } from "../api.jsx";
import {
  paymentsConfig, createPaymentOrder, verifyPayment, paymentsHistory,
  paymentReceipt, loadRazorpay,
} from "../api.jsx";
import { Icon, Spinner, SectionLabel } from "../ui.jsx";

const rupees = (paise) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const STATUS_TONE = {
  paid: "text-secondary", created: "text-on-variant", pending: "text-amber-600",
  failed: "text-error", cancelled: "text-error", refunded: "text-primary",
};

export default function Payments() {
  const { user } = useAuth();
  const [tab, setTab] = useState("services");
  const [cfg, setCfg] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const reload = () => paymentsHistory().then(setHistory).catch(() => setHistory([]));
  useEffect(() => { paymentsConfig().then(setCfg).catch(() => setCfg({ services: [], mode: "simulated" })); reload(); }, []);

  async function pay(svc) {
    setBusy(svc.code); setMsg(null);
    try {
      const order = await createPaymentOrder(svc.code);
      if (order.mode === "simulated") {
        // simulated: the backend handed us a locally-signed mock payment
        const c = order.simulated_client;
        const r = await verifyPayment({
          order_id: order.order_id, razorpay_order_id: c.razorpay_order_id,
          razorpay_payment_id: c.razorpay_payment_id, razorpay_signature: c.razorpay_signature,
          method: c.method,
        });
        setMsg({ ok: true, text: `Simulated payment successful · Receipt ${r.receipt_no}` });
        reload();
        return;
      }
      // real Razorpay TEST checkout
      const ok = await loadRazorpay();
      if (!ok) throw new Error("Could not load Razorpay Checkout");
      const rzp = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency,
        name: "CivicPulse Civic Services", description: order.service_name,
        order_id: order.provider_order_id, prefill: { name: user.name, email: user.email },
        theme: { color: "#0d5c63" },
        handler: async (resp) => {
          try {
            const r = await verifyPayment({
              order_id: order.order_id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            setMsg({ ok: true, text: `Payment successful · Receipt ${r.receipt_no}` });
          } catch (e) { setMsg({ ok: false, text: e.message }); }
          reload();
        },
        modal: { ondismiss: () => setMsg({ ok: false, text: "Payment cancelled" }) },
      });
      rzp.open();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(""); }
  }

  if (!cfg) return <Spinner />;
  const sim = cfg.mode !== "test";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[2.3rem] leading-[1.05] font-bold tracking-tight">Civic<br /><span className="text-primary">Services.</span></h1>
        <p className="text-on-variant mt-2 text-sm">Pay municipal fees securely. Reporting civic problems is always free.</p>
      </div>

      <div className={`rounded-2xl p-3 text-xs flex items-start gap-2 ${sim ? "bg-amber-500/10 text-amber-800" : "bg-secondary/10 text-secondary"}`}>
        <Icon name={sim ? "science" : "verified_user"} className="text-base mt-px" />
        <span>{cfg.note}</span>
      </div>

      <div className="flex gap-2">
        {["services", "history"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-full text-sm font-bold capitalize ${tab === t ? "bg-primary text-white" : "bg-white shadow-sm card-line text-on-variant"}`}>
            {t === "services" ? "Services" : "My Payments"}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`rounded-2xl p-3 text-sm font-medium ${msg.ok ? "bg-secondary/10 text-secondary" : "bg-error/10 text-error"}`}>
          {msg.text}
        </div>
      )}

      {tab === "services" && (
        <div className="space-y-3">
          {cfg.services.map((s) => (
            <div key={s.code} className="bg-white rounded-2xl p-4 shadow-sm card-line flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold">{s.name}</p>
                <p className="text-xs text-on-variant">{s.desc}</p>
                <p className="text-primary font-black font-headline mt-1">{rupees(s.amount)}</p>
              </div>
              <button disabled={busy === s.code} onClick={() => pay(s)}
                className="px-4 py-2.5 rounded-full bg-primary text-white text-sm font-bold flex-shrink-0 disabled:opacity-50">
                {busy === s.code ? "…" : "Pay now"}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "history" && (!history ? <Spinner /> : (
        <div className="space-y-3">
          {history.length === 0 && <p className="text-sm text-on-variant">No payments yet.</p>}
          {history.map((h) => (
            <div key={h.id} className="bg-white rounded-2xl p-4 shadow-sm card-line">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold">{h.service}</p>
                  <p className="text-xs text-on-variant">{new Date(h.date).toLocaleString()}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Txn {h.transaction_id}</p>
                </div>
                <div className="text-right">
                  <p className="font-black font-headline">{rupees(h.amount)}</p>
                  <p className={`text-xs font-bold uppercase ${STATUS_TONE[h.status] || ""}`}>{h.status}</p>
                </div>
              </div>
              {h.status === "paid" && (
                <button onClick={() => paymentReceipt(h.id).then(setReceipt)}
                  className="mt-2 text-xs font-bold text-primary flex items-center gap-1">
                  <Icon name="receipt_long" className="text-sm" /> View receipt
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setReceipt(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Icon name="receipt_long" className="text-primary" fill />
              <h3 className="font-bold text-lg">Receipt</h3>
            </div>
            {[["Receipt no", receipt.receipt_no], ["Service", receipt.service],
              ["Amount", rupees(receipt.amount)], ["Payer", receipt.payer],
              ["Transaction", receipt.transaction_id], ["Paid at", new Date(receipt.paid_at).toLocaleString()],
              ["Mode", receipt.mode]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-on-variant">{k}</span><span className="font-semibold text-right ml-4 break-all">{v}</span>
              </div>
            ))}
            <p className="text-[11px] text-slate-400 pt-1">{receipt.note}</p>
            <button onClick={() => setReceipt(null)} className="w-full mt-2 py-3 rounded-full bg-primary text-white font-bold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
