import { redirect } from "next/navigation";
import { MusicManager } from "@/components/admin/MusicManager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export default async function AdminMusicPage(){if(!(await isAdminAuthenticated()))redirect("/admin/login");return <MusicManager/>}
