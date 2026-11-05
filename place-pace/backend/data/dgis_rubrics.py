# Список рубрик 2GIS для живого поиска достопримечательностей

# Категория -> (рубрики 2GIS, длительность визита по умолчанию в минутах)
CATEGORY_RUBRICS = {
    'Музеи': (['193', '190'], 90),
    'Храмы и монастыри': (['194', '19575'], 45),
    'Парки': (['168', '24169'], 90),
    'Театры': (['199'], 45),
    'Зоопарки и океанариумы': (['167', '15800', '9508'], 120),
    'Смотровые площадки': (['111526'], 30),
    'Торговые центры': (['19499'], 90),
}

# Обратный индекс rubric_id -> категория
RUBRIC_TO_CATEGORY = {
    rubric_id: category
    for category, (rubric_ids, _duration) in CATEGORY_RUBRICS.items()
    for rubric_id in rubric_ids
}

DEFAULT_DURATION_BY_CATEGORY = {
    category: duration for category, (_rubric_ids, duration) in CATEGORY_RUBRICS.items()
}


def category_for_rubrics(item_rubric_ids):
    """Категория по рубрикам точки 2GIS (None - рубрики не из белого списка)"""
    for rubric_id in item_rubric_ids:
        category = RUBRIC_TO_CATEGORY.get(rubric_id)
        if category:
            return category
    return None
