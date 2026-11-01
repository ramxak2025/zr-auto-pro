import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { productKitsApi, productsApi } from '../api/services';
import type { KitRecipe } from '../../../shared/api/productKits';
import { Text } from '../platform/Typography';
import Modal from './Modal';
import { Button } from './Button';
import { useColors } from '../contexts/ThemeContext';

export default function ProductKitRecipes({
  onClose,
  onAssemble,
  onEdit,
}: {
  onClose: () => void;
  onAssemble: (recipe: KitRecipe) => void;
  onEdit: (recipe: KitRecipe) => void;
}) {
  const palette = useColors();
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
    <Modal visible onClose={onClose} title="Составы комплектов">
      <View style={{ gap: 12 }}>
        <Text color={palette.text.secondary}>
          Состав сохраняется после разборки партии. Выберите его, чтобы собрать ещё.
        </Text>
        {recipes.isPending && <Text>Загрузка составов…</Text>}
        {recipes.isError && (
          <Button title="Не удалось загрузить · Повторить" variant="secondary" onPress={() => void recipes.refetch()} />
        )}
        {recipes.data?.length === 0 && (
          <Text color={palette.text.secondary}>После первой сборки её состав появится здесь.</Text>
        )}
        {recipes.data?.map((recipe) => (
          <View
            key={recipe.id}
            style={{ borderBottomWidth: 1, borderBottomColor: palette.border.subtle, paddingVertical: 12, gap: 12 }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(recipe)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text>
                {recipe.name} · версия {recipe.version}
              </Text>
            </Pressable>
            {selected?.id === recipe.id && (
              <>
                {composition.isPending && <Text>Загрузка товаров…</Text>}
                {composition.isError && (
                  <Button
                    title="Не удалось проверить компоненты · Повторить"
                    variant="secondary"
                    onPress={() => void composition.refetch()}
                  />
                )}
                {composition.data?.map((line) => (
                  <Text key={line.productId} color={palette.text.secondary}>
                    {line.product.name} · {line.quantity} {line.product.unit}
                  </Text>
                ))}
                <Button
                  title="Собрать ещё"
                  variant="secondary"
                  disabled={!composition.data || composition.isError}
                  onPress={() => onAssemble(recipe)}
                />
                <Button title="Изменить сохранённый состав" variant="secondary" onPress={() => onEdit(recipe)} />
              </>
            )}
          </View>
        ))}
      </View>
    </Modal>
  );
}

export function KitRecipeComposition({ recipeId, version }: { recipeId: string; version: number }) {
  const detail = useQuery({
    queryKey: ['kit-recipe-composition', recipeId, version],
    queryFn: async () => {
      const recipe = (await productKitsApi.recipe(recipeId, version)).data;
      return Promise.all(
        recipe.components.map(async (line) => ({ ...line, product: (await productsApi.getById(line.productId)).data })),
      );
    },
  });
  const palette = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text color={palette.text.secondary}>Состав версии {version}</Text>
      {detail.isPending && <Text>Загрузка состава…</Text>}
      {detail.isError && (
        <Button
          title="Не удалось загрузить состав · Повторить"
          variant="secondary"
          onPress={() => void detail.refetch()}
        />
      )}
      {detail.data?.map((line) => (
        <Text key={line.productId} color={palette.text.secondary}>
          {line.product.name} · {line.quantity} {line.product.unit}
        </Text>
      ))}
    </View>
  );
}
