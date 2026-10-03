from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO_ROOT / "templates" / "index.html"
VOID_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
IDREF_ATTRIBUTES = (
    "aria-controls",
    "aria-describedby",
    "aria-labelledby",
    "aria-owns",
)
KNOWN_UNRESOLVED_IDREFS = {("aria-labelledby", "fitnessFatigueTitle")}


class Element:
    def __init__(self, tag: str, attributes: dict[str, str | None], parent: "Element | None"):
        self.tag = tag
        self.attributes = attributes
        self.parent = parent
        self.children: list[Element] = []


class CompositionParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.document = Element("#document", {}, None)
        self.stack = [self.document]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._append_element(tag, attrs, push=tag not in VOID_ELEMENTS)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._append_element(tag, attrs, push=False)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def _append_element(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
        *,
        push: bool,
    ) -> None:
        element = Element(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(element)
        if push:
            self.stack.append(element)


def parse_index() -> tuple[str, Element]:
    source = INDEX_PATH.read_text(encoding="utf-8")
    parser = CompositionParser()
    parser.feed(source)
    parser.close()
    return source, parser.document


def descendants(element: Element) -> list[Element]:
    return [
        child
        for descendant in element.children
        for child in (descendant, *descendants(descendant))
    ]


def all_elements(document: Element) -> list[Element]:
    return descendants(document)


def by_id(document: Element, element_id: str) -> Element:
    matches = [element for element in all_elements(document) if element.attributes.get("id") == element_id]
    assert len(matches) == 1, f"expected one element with id {element_id!r}, found {len(matches)}"
    return matches[0]


def by_tag(document: Element, tag: str) -> list[Element]:
    return [element for element in all_elements(document) if element.tag == tag]


def classes(element: Element) -> set[str]:
    return set((element.attributes.get("class") or "").split())


def has_ancestor(element: Element, ancestor_id: str) -> bool:
    parent = element.parent
    while parent is not None:
        if parent.attributes.get("id") == ancestor_id:
            return True
        parent = parent.parent
    return False


def has_ancestor_class(element: Element, class_name: str) -> bool:
    parent = element.parent
    while parent is not None:
        if class_name in classes(parent):
            return True
        parent = parent.parent
    return False


def direct_children_with_ids(element: Element, tag: str | None = None) -> list[str]:
    return [
        child.attributes["id"]
        for child in element.children
        if child.attributes.get("id") and (tag is None or child.tag == tag)
    ]


def asset_path(value: str | None) -> str:
    assert value is not None
    return urlsplit(value).path


def test_stylesheet_and_synchronous_script_order_is_stable() -> None:
    _, document = parse_index()

    stylesheet_paths = [
        asset_path(element.attributes.get("href"))
        for element in by_tag(document, "link")
        if element.attributes.get("rel") == "stylesheet"
    ]
    assert stylesheet_paths == [
        "/static/style.css",
        "/static/daily.css",
        "/static/gear.css",
        "/static/zones.css",
        "/static/search.css",
        "/static/components.css",
        "/static/plan.css",
        "/static/goals.css",
        "/static/kpis.css",
        "/static/charts.css",
        "/static/settings.css",
        "/static/weekly.css",
        "/static/yearly.css",
        "/static/coach-layout.css",
        "/static/coach-sessions.css",
        "/static/coach-conversation.css",
        "/static/coach-composer.css",
        "/static/coach-context.css",
        "/static/coach-responsive.css",
    ]

    scripts = [element for element in by_tag(document, "script") if element.attributes.get("src")]
    script_paths = [asset_path(element.attributes.get("src")) for element in scripts]
    assert script_paths == [
        "/static/constants.js",
        "/static/app-state.js",
        "/static/utils.js",
        "/static/api.js",
        "/static/weekly.js",
        "/static/zones.js",
        "/static/gear.js",
        "/static/components.js",
        "/static/sync.js",
        "/static/yearly.js",
        "/static/ai-coach-settings-validation.js",
        "/static/ai-coach-custom-instructions-validation.js",
        "/static/coach-memories.js",
        "/static/settings.js",
        "/static/daily.js",
        "/static/search.js",
        "/static/plan.js",
        "/static/goals.js",
        "/static/kpis.js",
        "/static/vendor/chart.umd.min.js",
        "/static/charts.js",
        "/static/coach.js",
        "/static/app.js",
    ]
    assert all("async" not in element.attributes for element in scripts)
    assert all("defer" not in element.attributes for element in scripts)
    assert all(element.attributes.get("type") != "module" for element in scripts)


def test_static_ids_and_accessibility_references_are_characterized() -> None:
    _, document = parse_index()
    elements = all_elements(document)
    ids = [element.attributes["id"] for element in elements if element.attributes.get("id")]
    assert len(ids) == len(set(ids))

    id_set = set(ids)
    unresolved: set[tuple[str, str]] = set()
    for element in elements:
        label_target = element.attributes.get("for")
        if label_target and label_target not in id_set:
            unresolved.add(("for", label_target))
        for attribute in IDREF_ATTRIBUTES:
            value = element.attributes.get(attribute)
            if value:
                unresolved.update(
                    (attribute, target)
                    for target in value.split()
                    if target not in id_set
                )

    # This single unresolved target is pre-existing; keep it visible rather than treating it as valid.
    assert unresolved == KNOWN_UNRESOLVED_IDREFS
    assert not any(element.attributes.get("id") == "fitnessFatigueTitle" for element in elements)


def test_navigation_panes_and_default_tab_states_are_stable() -> None:
    _, document = parse_index()
    header_tabs = next(
        element
        for element in all_elements(document)
        if "header-tabs" in classes(element)
    )
    expected_tabs = [
        "coachTab",
        "planTab",
        "weeklyTab",
        "dailyTab",
        "searchTab",
        "goalsTab",
        "kpisTab",
        "chartsTab",
        "zonesTab",
        "serviceTab",
        "yearlyTab",
    ]
    assert direct_children_with_ids(header_tabs, "button") == expected_tabs

    main = next(element for element in by_tag(document, "main"))
    feature_panes = [
        "planPane",
        "goalsPane",
        "kpisPane",
        "chartsPane",
        "dailyPane",
        "searchPane",
        "weeklyPane",
        "zonesPane",
        "servicePane",
        "yearlyPane",
        "coachPane",
    ]
    assert direct_children_with_ids(main, "section") == feature_panes

    assert "active" in classes(by_id(document, "dailyTab"))
    assert "hidden" not in classes(by_id(document, "dailyPane"))
    for tab_id, pane_id in zip(expected_tabs, [
        "coachPane",
        "planPane",
        "weeklyPane",
        "dailyPane",
        "searchPane",
        "goalsPane",
        "kpisPane",
        "chartsPane",
        "zonesPane",
        "servicePane",
        "yearlyPane",
    ]):
        if tab_id != "dailyTab":
            assert "active" not in classes(by_id(document, tab_id))
            assert "hidden" in classes(by_id(document, pane_id))

    settings_tabs = [
        element
        for element in all_elements(by_id(document, "settingsDrawer"))
        if element.attributes.get("role") == "tab"
    ]
    assert [element.attributes.get("data-settings-tab") for element in settings_tabs] == [
        "general",
        "yearly",
        "ai-coach",
    ]
    assert settings_tabs[0].attributes.get("aria-selected") == "true"
    assert "active" in classes(settings_tabs[0])
    assert "hidden" not in classes(by_id(document, "settingsGeneralTab"))
    for tab, panel_id in zip(settings_tabs[1:], ("settingsYearlyTab", "settingsAiCoachTab")):
        assert tab.attributes.get("aria-selected") == "false"
        assert "hidden" in classes(by_id(document, panel_id))
    assert "hidden" in classes(by_id(document, "settingsDrawer"))
    assert by_id(document, "settingsDrawer").attributes.get("aria-hidden") == "true"

    charts_tabs = [
        element
        for element in all_elements(by_id(document, "chartsPane"))
        if element.attributes.get("role") == "tab"
    ]
    assert [element.attributes.get("data-charts-category") for element in charts_tabs] == [
        "fitness",
        "load",
        "health",
        "volume",
    ]
    assert charts_tabs[0].attributes.get("aria-selected") == "true"
    assert "active" in classes(charts_tabs[0])
    assert "hidden" not in classes(by_id(document, "chartsFitnessPanel"))
    for panel_id in ("chartsLoadPanel", "chartsHealthPanel", "chartsVolumePanel"):
        assert "hidden" in classes(by_id(document, panel_id))

    service_tabs = [
        element
        for element in all_elements(by_id(document, "servicePane"))
        if element.attributes.get("role") == "tab"
    ]
    assert [element.attributes.get("id") for element in service_tabs] == [
        "componentsSubtab",
        "gearSubtab",
    ]
    assert service_tabs[0].attributes.get("aria-selected") == "true"
    assert service_tabs[0].attributes.get("tabindex") == "0"
    assert service_tabs[1].attributes.get("aria-selected") == "false"
    assert service_tabs[1].attributes.get("tabindex") == "-1"
    assert "hidden" not in classes(by_id(document, "componentsPane"))
    assert "hidden" in classes(by_id(document, "gearPane"))


def test_settings_service_forms_and_overlays_keep_their_boundaries() -> None:
    _, document = parse_index()
    body = next(element for element in by_tag(document, "body"))
    assert [child.tag for child in body.children[:3]] == ["header", "div", "main"]
    assert body.children[1].attributes.get("id") == "settingsDrawer"
    assert all(child.tag == "script" for child in body.children[3:])

    service = by_id(document, "servicePane")
    assert service.children[0].attributes.get("role") == "tablist"
    assert "service-subnav" in classes(service.children[0])
    service_sections = [
        child.attributes.get("id")
        for child in service.children
        if child.tag == "section"
    ]
    assert service_sections == ["gearPane", "componentsPane"]

    search_form = by_id(document, "searchForm")
    coach_form = by_id(document, "coachComposer")
    memory_form = by_id(document, "aiCoachMemoryForm")
    assert search_form.tag == coach_form.tag == memory_form.tag == "form"
    assert has_ancestor(search_form, "searchPane")
    assert has_ancestor(coach_form, "coachPane")
    assert has_ancestor(memory_form, "settingsAiCoachTab")
    assert not has_ancestor(by_id(document, "searchResults"), "searchForm")

    for button_id in ("searchClear", "searchPrevious", "searchNext"):
        assert by_id(document, button_id).attributes.get("type") == "button"
    search_submit = [
        element
        for element in descendants(search_form)
        if element.tag == "button" and element.attributes.get("type") == "submit"
    ]
    assert len(search_submit) == 1

    assert by_id(document, "coachSend").attributes.get("type") == "submit"
    assert by_id(document, "aiCoachMemorySave").attributes.get("type") == "submit"
    assert by_id(document, "aiCoachMemoryCancel").attributes.get("type") == "button"

    main = next(element for element in by_tag(document, "main"))
    assert by_id(document, "coachDeleteDialog").parent is main
    assert by_id(document, "weeklyDrawer").parent is main
    assert "hidden" in classes(by_id(document, "coachDeleteDialog"))
    assert "hidden" in classes(by_id(document, "weeklyDrawer"))
    assert has_ancestor_class(coach_form, "coach-main-panel")


def test_markup_has_no_inline_event_handler_attributes() -> None:
    _, document = parse_index()
    event_attributes = {
        attribute
        for element in all_elements(document)
        for attribute in element.attributes
        if attribute.lower().startswith("on")
    }
    assert not event_attributes
