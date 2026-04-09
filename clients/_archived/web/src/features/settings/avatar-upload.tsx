import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useUploadAvatar, useDeleteAvatar } from './hooks/use-profile';

interface AvatarUploadProps {
  avatarUrl: string | null;
  displayName: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function AvatarUpload({ avatarUrl, displayName }: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    uploadAvatar.mutate(file);
    e.target.value = '';
  }

  const isUploading = uploadAvatar.isPending;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        {isUploading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
            {getInitials(displayName)}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          Upload Photo
        </Button>
        {avatarUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteAvatar.mutate()}
            disabled={deleteAvatar.isPending}
          >
            Remove Photo
          </Button>
        )}
      </div>
    </div>
  );
}
