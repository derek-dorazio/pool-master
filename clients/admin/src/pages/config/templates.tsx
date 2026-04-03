import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileCode2, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  client,
  adminDeleteScoringTemplate,
  adminUpdateScoringTemplate,
  adminDeleteSelectionTemplate,
  adminUpdateSelectionTemplate,
} from '@/lib/api';
import {
  useScoringTemplates,
  useSelectionTemplates,
} from '@/hooks/use-config-api';
import type { ScoringTemplate, SelectionTemplate } from '@/hooks/use-config-api';

type AnyTemplate = ScoringTemplate | SelectionTemplate;
type TemplateKind = 'scoring' | 'selection';

function TemplateTable({
  templates,
  onEdit,
  onDelete,
}: {
  templates: AnyTemplate[];
  onEdit: (template: AnyTemplate) => void;
  onDelete: (template: AnyTemplate) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Sport</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Description</th>
            <th className="px-4 py-3 text-left font-medium">Last Modified</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3">
                <Badge variant="outline" className="text-xs">{t.sport}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{t.type}</td>
              <td className="px-4 py-3 text-muted-foreground max-w-[300px] truncate">
                {t.description}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{t.lastModified}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {confirmDelete === t.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => {
                          onDelete(t);
                          setConfirmDelete(null);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => setConfirmDelete(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditModal({
  template,
  onClose,
  onSave,
}: {
  template: AnyTemplate;
  onClose: () => void;
  onSave: (updated: AnyTemplate) => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-lg">Edit Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Sport</label>
            <Input value={template.sport} disabled />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <Input value={template.type} disabled />
          </div>
          {'contestType' in template && (
            <div>
              <label className="mb-1 block text-sm font-medium">Contest Type</label>
              <Input value={template.contestType} disabled />
            </div>
          )}
          {'selectionType' in template && (
            <div>
              <label className="mb-1 block text-sm font-medium">Selection Type</label>
              <Input value={template.selectionType} disabled />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave({ ...template, name, description })}>
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function Component() {
  const { data: scoringTemplates = [] } = useScoringTemplates();
  const { data: selectionTemplates = [] } = useSelectionTemplates();
  const [editingTemplate, setEditingTemplate] = useState<AnyTemplate | null>(null);
  const [editingKind, setEditingKind] = useState<TemplateKind | null>(null);

  function openEditor(template: AnyTemplate, kind: TemplateKind) {
    setEditingTemplate(template);
    setEditingKind(kind);
  }

  async function handleDelete(template: AnyTemplate, kind: TemplateKind) {
    if (kind === 'selection') {
      await adminDeleteSelectionTemplate({ client, path: { id: template.id } });
      return;
    }

    await adminDeleteScoringTemplate({ client, path: { id: template.id } });
  }

  async function handleSave(updated: AnyTemplate) {
    if (editingKind === 'selection') {
      const selectionTemplate = updated as SelectionTemplate;
      await adminUpdateSelectionTemplate({
        client,
        path: { id: selectionTemplate.id },
        body: {
          name: selectionTemplate.name,
          description: selectionTemplate.description,
          sport: selectionTemplate.sport,
          contestType: selectionTemplate.contestType,
          selectionType: selectionTemplate.selectionType,
          config: selectionTemplate.config,
        },
      });
    } else {
      const scoringTemplate = updated as ScoringTemplate;
      await adminUpdateScoringTemplate({
        client,
        path: { id: scoringTemplate.id },
        body: {
          name: scoringTemplate.name,
          description: scoringTemplate.description,
          sport: scoringTemplate.sport,
          config: scoringTemplate.config,
        },
      });
    }
    setEditingTemplate(null);
    setEditingKind(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileCode2 className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Template Management</h1>
      </div>

      <Tabs defaultValue="scoring">
        <TabsList>
          <TabsTrigger value="scoring">Scoring Templates</TabsTrigger>
          <TabsTrigger value="selection">Selection Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Scoring Templates</CardTitle>
              <Button size="sm" disabled title="Template creation is not wired here yet">
                <Plus className="mr-2 h-4 w-4" />
                Create Template
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <TemplateTable
                templates={scoringTemplates}
                onEdit={(template) => openEditor(template, 'scoring')}
                onDelete={(template) => handleDelete(template, 'scoring')}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="selection">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Selection Templates</CardTitle>
              <Button size="sm" disabled title="Template creation is not wired here yet">
                <Plus className="mr-2 h-4 w-4" />
                Create Template
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <TemplateTable
                templates={selectionTemplates}
                onEdit={(template) => openEditor(template, 'selection')}
                onDelete={(template) => handleDelete(template, 'selection')}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editingTemplate && editingKind && (
        <EditModal
          template={editingTemplate}
          onClose={() => {
            setEditingTemplate(null);
            setEditingKind(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
