import { useId, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Folder, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { knowledgeApi } from '../../api/services';
import type { KnowledgeCategory } from '../../types';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { KEY } from './keys';
import { errMessage, flattenCategories, indentedName } from './utils';

/**
 * Folder manager — create subfolders, rename, move (parentId), delete.
 * Surfaces the server's 400 cycle-rejection as a friendly message.
 */
export default function FolderManagerModal({
  presetParent,
  categories,
  childrenByParent,
  onClose,
}: {
  presetParent: string | null;
  categories: KnowledgeCategory[];
  childrenByParent: Map<string | null, KnowledgeCategory[]>;
  onClose: () => void;
}) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>(presetParent ?? '');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const options = useMemo(() => flattenCategories(categories), [categories]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEY.categories });

  const createMutation = useMutation({
    mutationFn: (vars: { name: string; parentId: string | null }) =>
      knowledgeApi.createCategory({ name: vars.name, parentId: vars.parentId }),
    onSuccess: () => {
      invalidate();
      setNewName('');
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось создать папку')),
  });

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; name: string }) => knowledgeApi.updateCategory(vars.id, { name: vars.name }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось переименовать')),
  });

  const moveMutation = useMutation({
    mutationFn: (vars: { id: string; parentId: string | null }) =>
      knowledgeApi.updateCategory(vars.id, { parentId: vars.parentId }),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(errMessage(err, 'Нельзя переместить папку внутрь самой себя или своей подпапки')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteCategory(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['knowledge', 'articles'] });
      setConfirmDeleteId(null);
    },
    onError: (err) => toast.error(errMessage(err, 'Не удалось удалить папку')),
  });

  // Descendant set for a category — invalid move targets (would create a cycle).
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(childrenByParent.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(...(childrenByParent.get(c.id) ?? []));
    }
    return out;
  };

  const create = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), parentId: newParent || null });
  };

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title="Папки базы знаний"
        description="Удаление папки не удаляет материалы и подпапки — они переезжают в корень."
        size="lg"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Готово
          </Button>
        }
      >
        <div className="space-y-4">
          {/* Create */}
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Новая папка" htmlFor={`${uid}-name`} className="flex-1">
                <Input
                  id={`${uid}-name`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') create();
                  }}
                  placeholder="Название папки"
                />
              </Field>
              <Field label="Где" htmlFor={`${uid}-parent`} className="sm:w-52">
                <Select id={`${uid}-parent`} value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                  <option value="">В корне</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {indentedName(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button icon={Plus} onClick={create} disabled={!newName.trim()} loading={createMutation.isPending}>
                Добавить
              </Button>
            </div>
          </div>

          {/* Tree list */}
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Папки">
            {options.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-ink-3">Папок пока нет</li>
            ) : (
              options.map((cat) => {
                const forbidden = descendantsOf(cat.id);
                const isEditing = editing?.id === cat.id;
                return (
                  <li key={cat.id} className="flex items-center gap-2 px-3 py-2">
                    <span style={{ width: cat.depth * 16 }} className="flex-shrink-0" aria-hidden="true" />
                    <Folder className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                    {isEditing ? (
                      <>
                        <Input
                          size="sm"
                          value={editing.name}
                          aria-label="Новое название папки"
                          onChange={(e) => setEditing({ id: cat.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editing.name.trim())
                              renameMutation.mutate({ id: cat.id, name: editing.name.trim() });
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="flex-1"
                          autoFocus
                        />
                        <IconButton
                          label="Сохранить название"
                          icon={Check}
                          size="sm"
                          variant="soft"
                          loading={renameMutation.isPending}
                          onClick={() =>
                            editing.name.trim() && renameMutation.mutate({ id: cat.id, name: editing.name.trim() })
                          }
                        />
                        <IconButton label="Отменить" icon={X} size="sm" onClick={() => setEditing(null)} />
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{cat.name}</span>
                        {/* Move under another folder */}
                        <Select
                          size="sm"
                          aria-label={`Переместить папку ${cat.name}`}
                          value={cat.parentId ?? ''}
                          onChange={(e) => moveMutation.mutate({ id: cat.id, parentId: e.target.value || null })}
                          className="w-40 text-xs"
                        >
                          <option value="">Корень</option>
                          {options
                            .filter((o) => o.id !== cat.id && !forbidden.has(o.id))
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {indentedName(o)}
                              </option>
                            ))}
                        </Select>
                        <IconButton
                          label={`Переименовать ${cat.name}`}
                          icon={Pencil}
                          size="sm"
                          onClick={() => setEditing({ id: cat.id, name: cat.name })}
                        />
                        <IconButton
                          label={`Удалить папку ${cat.name}`}
                          icon={Trash2}
                          size="sm"
                          variant="danger"
                          onClick={() => setConfirmDeleteId(cat.id)}
                        />
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
        title="Удалить папку?"
        message="Материалы и вложенные папки сохранятся и переместятся в корень базы знаний."
        confirmText="Удалить"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
