import type { Application, ApplicationFormData } from "@/app/applications/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchApplications(
  supabase: SupabaseClient
): Promise<Application[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching applications:", error);
    throw error;
  }

  // Transform database format to Application interface
  return (data || []).map((app) => ({
    id: app.id,
    company: app.company,
    role: app.role,
    location: app.location,
    jobPortal: app.job_portal,
    appliedDate: app.applied_date,
    status: app.status,
    salary: app.salary || undefined,
  }));
}

export async function createApplication(
  supabase: SupabaseClient,
  formData: ApplicationFormData
): Promise<Application> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company: formData.company,
      role: formData.role,
      location: formData.location,
      job_portal: formData.jobPortal,
      applied_date: formData.appliedDate,
      status: formData.status,
      salary: formData.salary || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating application:", error);
    throw error;
  }

  return {
    id: data.id,
    company: data.company,
    role: data.role,
    location: data.location,
    jobPortal: data.job_portal,
    appliedDate: data.applied_date,
    status: data.status,
    salary: data.salary || undefined,
  };
}

export async function updateApplication(
  supabase: SupabaseClient,
  id: string,
  formData: ApplicationFormData
): Promise<Application> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("applications")
    .update({
      company: formData.company,
      role: formData.role,
      location: formData.location,
      job_portal: formData.jobPortal,
      applied_date: formData.appliedDate,
      status: formData.status,
      salary: formData.salary || null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("Error updating application:", error);
    throw error;
  }

  return {
    id: data.id,
    company: data.company,
    role: data.role,
    location: data.location,
    jobPortal: data.job_portal,
    appliedDate: data.applied_date,
    status: data.status,
    salary: data.salary || undefined,
  };
}

export async function deleteApplication(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error deleting application:", error);
    throw error;
  }
}

export async function duplicateApplication(
  supabase: SupabaseClient,
  application: Application
): Promise<Application> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: user.id,
      company: `${application.company} (Copy)`,
      role: application.role,
      location: application.location,
      job_portal: application.jobPortal,
      applied_date: application.appliedDate,
      status: application.status,
      salary: application.salary || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error duplicating application:", error);
    throw error;
  }

  return {
    id: data.id,
    company: data.company,
    role: data.role,
    location: data.location,
    jobPortal: data.job_portal,
    appliedDate: data.applied_date,
    status: data.status,
    salary: data.salary || undefined,
  };
}
