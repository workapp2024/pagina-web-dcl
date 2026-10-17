-- PROPUESTA DE ROLLBACK. NO EJECUTAR SIN AUTORIZACIÓN.
-- Solo retira una instalación nueva SIN operaciones. Nunca borra evidencia usada.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.financial_sector_operations,public.financial_sector_allocations IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.financial_sector_operations) OR EXISTS(SELECT 1 FROM public.financial_sector_allocations) THEN
    RAISE EXCEPTION 'SECTOR_FINANCE_ROLLBACK_HAS_HISTORY';
  END IF;
END $$;
DROP TRIGGER sector_cash_immutable ON public.cash_movements;
DROP FUNCTION public.record_sector_finance(text,varchar,numeric,text,text,timestamptz,text,text,uuid,uuid,uuid,text,uuid);
DROP FUNCTION public.assert_sector_finance_debit(uuid,varchar,text,numeric,timestamptz);
DROP FUNCTION public.sector_financial_balance(uuid,varchar,text);
DROP FUNCTION public.guard_sector_cash_history();
DROP TABLE public.financial_sector_allocations;
DROP TABLE public.financial_sector_operations;
DROP FUNCTION public.guard_sector_finance_history();
COMMIT;
