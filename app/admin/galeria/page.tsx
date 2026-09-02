import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { GalleryManager } from "@/components/admin/GalleryManager";
export default async function GalleryPage(){if(!(await isAdminAuthenticated()))redirect("/admin/login");return <GalleryManager/>}
