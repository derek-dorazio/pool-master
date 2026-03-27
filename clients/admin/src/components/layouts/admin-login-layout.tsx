import { Outlet } from 'react-router-dom';

export function AdminLoginLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  );
}
