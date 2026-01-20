using System.Xml;

namespace LegendsAndMaps.Services;

public sealed class CountryCatalog
{
    private readonly HashSet<string> _countryIds;
    private readonly Dictionary<string, string> _normalizedNameToId;

    public IReadOnlyCollection<string> CountryIds => _countryIds;

    /// <summary>
    /// Normalized (forgiving) country name to ISO id (2 letters) as used by the SVG.
    /// </summary>
    public IReadOnlyDictionary<string, string> NormalizedNameToId => _normalizedNameToId;

    public CountryCatalog(IReadOnlyCollection<string> countryIds, IReadOnlyDictionary<string, string>? normalizedNameToId = null)
    {
        _countryIds = new HashSet<string>(countryIds ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        _normalizedNameToId = normalizedNameToId is null
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(normalizedNameToId, StringComparer.OrdinalIgnoreCase);
    }

    public bool ContainsId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }

        return _countryIds.Contains(id.Trim().ToUpperInvariant());
    }

    public bool TryResolveIdFromName(string? name, out string id)
    {
        id = "";
        if (string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        var key = Import.CountryIdResolver.NormalizeName(name.Trim());
        if (key.Length == 0)
        {
            return false;
        }

        if (_normalizedNameToId.TryGetValue(key, out var found) && !string.IsNullOrWhiteSpace(found))
        {
            id = found;
            return true;
        }

        return false;
    }

    public static CountryCatalog LoadFromSvgContent(string svgContent)
    {
        var (ids, nameMap) = LoadCountryDataFromSvgContent(svgContent);
        return new CountryCatalog(ids, nameMap);
    }

    public static IReadOnlyCollection<string> LoadCountryIdsFromSvgContent(string svgContent)
    {
        var (ids, _) = LoadCountryDataFromSvgContent(svgContent);
        return ids;
    }

    private static (IReadOnlyCollection<string> Ids, IReadOnlyDictionary<string, string> NormalizedNameToId)
        LoadCountryDataFromSvgContent(string svgContent)
    {
        if (string.IsNullOrWhiteSpace(svgContent))
        {
            return (Array.Empty<string>(), new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase));
        }

        var doc = new XmlDocument
        {
            XmlResolver = null
        };

        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            // Keep this generous enough for our world.svg, but bounded.
            MaxCharactersInDocument = 5_000_000,
            MaxCharactersFromEntities = 0
        };

        using var stringReader = new StringReader(svgContent);
        using var xmlReader = XmlReader.Create(stringReader, settings);
        doc.Load(xmlReader);

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var nameToId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        string? normalizeId(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            var trimmed = raw.Trim();
            // Our SVG uses ISO-like 2-letter ids (e.g. "us", "gb", "ps").
            // Keep this strict to avoid accidentally treating internal sub-groups (e.g. "cnx") as countries.
            if (trimmed.Length != 2)
            {
                return null;
            }

            for (var i = 0; i < trimmed.Length; i++)
            {
                if (!char.IsLetter(trimmed[i]))
                {
                    return null;
                }
            }

            return trimmed.ToUpperInvariant();
        }

        if (doc.DocumentElement is null)
        {
            return (Array.Empty<string>(), nameToId);
        }

        var all = doc.DocumentElement.SelectNodes("//*[@id]");
        if (all is null)
        {
            return (Array.Empty<string>(), nameToId);
        }

        foreach (XmlNode node in all)
        {
            if (node.Attributes is null)
            {
                continue;
            }

            var id = normalizeId(node.Attributes["id"]?.Value);
            if (id is null)
            {
                continue;
            }

            // Treat an element as a "country" if it has a title itself OR contains titled descendants.
            // Many country <g id="xx"> nodes in BlankMap-style SVGs store the title on a child path.
            // SVG uses a default XML namespace, so use namespace-agnostic selectors.
            var directTitleNode = node.SelectSingleNode("*[local-name()='title']");
            var directTitle = directTitleNode?.InnerText;

            var descendantTitleNodes = node.SelectNodes(".//*[local-name()='title']");
            var hasAnyTitle = !string.IsNullOrWhiteSpace(directTitle)
                || (descendantTitleNodes is not null && descendantTitleNodes.Count > 0);

            if (!hasAnyTitle)
            {
                continue;
            }

            ids.Add(id);

            if (!string.IsNullOrWhiteSpace(directTitle))
            {
                var normalizedName = Import.CountryIdResolver.NormalizeName(directTitle);
                if (normalizedName.Length > 0)
                {
                    // First wins for stability.
                    nameToId.TryAdd(normalizedName, id);
                }
            }
            else if (descendantTitleNodes is not null)
            {
                // If the country node itself has no title (e.g. Palestine's <g id="ps">),
                // map any titled descendants to the country's id.
                foreach (XmlNode titleNode in descendantTitleNodes)
                {
                    var title = titleNode.InnerText;
                    if (string.IsNullOrWhiteSpace(title))
                    {
                        continue;
                    }

                    var normalizedName = Import.CountryIdResolver.NormalizeName(title);
                    if (normalizedName.Length > 0)
                    {
                        nameToId.TryAdd(normalizedName, id);
                    }
                }
            }
        }

        return (ids.ToArray(), nameToId);
    }
}
