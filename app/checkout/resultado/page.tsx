import { CheckoutResult } from "@/components/store/CheckoutResult";
export default async function Resultado({searchParams}:{searchParams:Promise<{order?:string}>}){const params=await searchParams;return <CheckoutResult orderId={params.order||""}/>}
