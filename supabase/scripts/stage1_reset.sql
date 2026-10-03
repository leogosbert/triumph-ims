-- =====================================================================
-- Removes everything the Stage 1 setup created, so it can be run again
-- cleanly. DELETES all companies, teams, invitations and activity.
-- Sign-in accounts (auth.users) and uploaded files are kept.
-- Only for use before real data is entered.
-- =====================================================================
drop policy if exists branding_manage_insert on storage.objects;
drop policy if exists branding_manage_update on storage.objects;
drop policy if exists branding_manage_delete on storage.objects;
drop policy if exists branding_member_select on storage.objects;
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.audit_log, public.invitations, public.memberships, public.profiles, public.companies cascade;

drop function if exists public.create_company(text) cascade;
drop function if exists public.invite_member(uuid, text, public.app_role) cascade;
drop function if exists public.revoke_invitation(uuid) cascade;
drop function if exists public.my_invitations() cascade;
drop function if exists public.accept_invitation(uuid) cascade;
drop function if exists public.update_membership(uuid, public.app_role, boolean) cascade;
drop function if exists public.is_member(uuid) cascade;
drop function if exists public.has_role(uuid, public.app_role[]) cascade;
drop function if exists public.is_manager(uuid) cascade;
drop function if exists public.shares_company_with(uuid) cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.audit_row() cascade;
drop type if exists public.app_role cascade;
