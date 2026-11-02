import { useAuth } from '../../contexts/AuthContext';
import ProductKitComposer from './ProductKitComposer';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productKitsApi, productsApi } from '../../api/services';
import type { KitRecipe } from '../../../../shared/api/productKits';
import Modal from '../Modal';
import { Button } from '../../ui';

export default function ProductKitRecipes({
  onClose,
  onAssemble,
}: {
  onClose: () => void;
  onAssemble: (recipe: KitRecipe) => void;
}) {
  const [editing, setEditing] = useState<KitRecipe | null>(null);
  const [selected, setSelected] = useState<KitRecipe | null>(null);
  const recipes = useQuery({
    queryKey: ['kit-recipes'],
    queryFn: async () => (await productKitsApi.recipes()).data,
    staleTime: 0,
  });
  const composition = useQuery({
    queryKey: ['kit-recipe-preview', selected?.id, selected?.version],
    enabled: !!selected,
    queryFn: async () =>
      Promise.all(
        (selected?.components ?? []).map(async (line) => ({
          ...line,
          product: (await productsApi.getById(line.productId)).data,
        })),
      ),
  });
  return (
    <>
      {editing && (
        <ProductKitComposer
          warehouseId=""
          recipeId={editing.id}
          recipeVersion={editing.version}
          recipeEdit
          onCompleted={() => {}}
          onClose={() => {
            setEditing(null);
            setSelected(null);
            void recipes.refetch();
          }}
          onRecipeSaved={() => {
            setEditing(null);
            setSelected(null);
            void recipes.refetch();
          }}
        />
      )}
      <Modal isOpen={!editing} onClose={onClose} title="Составы комплектов" size="lg">
        <p className="mb-4 text-sm text-ink-2">
          Состав сохраняется после разборки партии. Выберите его, чтобы собрать ещё.
        </p>
        {recipes.isPending && <p role="status">Загрузка составов…</p>}
        {recipes.isError && (
          <Button variant="secondary" onClick={() => void recipes.refetch()}>
            Не удалось загрузить · Повторить
          </Button>
        )}
        {recipes.data?.length === 0 && (
          <p className="text-sm text-ink-2">После первой сборки её состав появится здесь.</p>
        )}
        {recipes.data?.map((recipe) => (
          <div key={recipe.id} className="border-b border-line py-3">
            <button
              className="w-full text-left text-sm font-medium text-ink focus-visible:outline-accent"
              onClick={() => setSelected(recipe)}
            >
              {recipe.name} · версия {recipe.version}
            </button>
            {selected?.id === recipe.id && (
              <div className="mt-3 space-y-3">
                {composition.isPending && (
                  <p role="status" className="text-sm">
                    Загрузка товаров…
                  </p>
                )}
                {composition.isError && (
                  <p role="alert" className="text-sm text-bad-text">
                    Не удалось проверить компоненты.{' '}
                    <Button variant="secondary" size="sm" onClick={() => void composition.refetch()}>
                      Повторить
                    </Button>
                  </p>
                )}
                <ul className="text-sm text-ink-2">
                  {composition.data?.map((line) => (
                    <li key={line.productId}>
                      {line.product.name} · {line.quantity} {line.product.unit}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  disabled={!composition.data || composition.isError}
                  onClick={() => onAssemble(recipe)}
                >
                  Собрать ещё
                </Button>
                <Button variant="secondary" onClick={() => setEditing(recipe)}>
                  Изменить сохранённый состав
                </Button>
              </div>
            )}
          </div>
        ))}
      </Modal>
    </>
  );
}

export function KitRecipeComposition({ recipeId, version }: { recipeId: string; version: number }) {
  const canRead = useAuth().hasPermission('warehouse_access');
  const detail = useQuery({
    queryKey: ['kit-recipe-composition', recipeId, version],
    enabled: canRead,
    queryFn: async () => {
      if (!canRead) return [];
      const recipe = (await productKitsApi.recipe(recipeId, version)).data;
      return Promise.all(
        recipe.components.map(async (line) => ({ ...line, product: (await productsApi.getById(line.productId)).data })),
      );
    },
  });
  if (!canRead) return <p className="mt-2 text-sm text-ink-2">Состав версии {version}</p>;
  return (
    <div className="mt-2 text-sm text-ink-2">
      <p>Состав версии {version}</p>
      {detail.isPending && <p role="status">Загрузка состава…</p>}
      {detail.isError && (
        <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
          Не удалось загрузить состав · Повторить
        </Button>
      )}
      <ul>
        {detail.data?.map((line) => (
          <li key={line.productId}>
            {line.product.name} · {line.quantity} {line.product.unit}
          </li>
        ))}
      </ul>
    </div>
  );
}
