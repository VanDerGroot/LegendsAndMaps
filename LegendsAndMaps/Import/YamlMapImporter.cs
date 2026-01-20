using LegendsAndMaps.State;
using LegendsAndMaps.Services;
using YamlDotNet.Core;
using YamlDotNet.RepresentationModel;

namespace LegendsAndMaps.Import;

public sealed class YamlMapImporter
{
    private readonly CountryCatalog? _countryCatalog;

    private const int MaxYamlChars = 200_000;
    private const int MaxSets = 200;
    private const int MaxCountriesTotal = 6_000;
    private const int MaxNameChars = 120;
    private const int MaxColorChars = 40;

    public YamlMapImporter()
    {
    }

    public YamlMapImporter(CountryCatalog countryCatalog)
    {
        _countryCatalog = countryCatalog;
    }

    public YamlImportResult Parse(string yaml)
    {
        if (string.IsNullOrWhiteSpace(yaml))
        {
            throw new ArgumentException("YAML is empty.", nameof(yaml));
        }

        if (yaml.Length > MaxYamlChars)
        {
            throw new InvalidOperationException($"YAML is too large. Limit is {MaxYamlChars:N0} characters.");
        }

        // Keep the importer intentionally simple: disallow YAML features that can be used for "YAML bombs"
        // (anchors/aliases/merge keys) since this is user-supplied input.
        // Scan only outside quoted strings to avoid false positives (e.g. mapName: "A&B").
        static string StripQuotedStrings(string input)
        {
            var chars = input.ToCharArray();
            var inSingle = false;
            var inDouble = false;
            var escaped = false;

            for (var i = 0; i < chars.Length; i++)
            {
                var ch = chars[i];

                if (inDouble)
                {
                    if (!escaped && ch == '"')
                    {
                        inDouble = false;
                        chars[i] = ' ';
                        continue;
                    }

                    if (!escaped && ch == '\\')
                    {
                        escaped = true;
                    }
                    else
                    {
                        escaped = false;
                    }

                    chars[i] = ' ';
                    continue;
                }

                if (inSingle)
                {
                    if (ch == '\'' )
                    {
                        // YAML single-quote escapes by doubling (''). We treat all as quoted content.
                        inSingle = false;
                        chars[i] = ' ';
                        continue;
                    }

                    chars[i] = ' ';
                    continue;
                }

                if (ch == '"')
                {
                    inDouble = true;
                    escaped = false;
                    chars[i] = ' ';
                    continue;
                }

                if (ch == '\'')
                {
                    inSingle = true;
                    chars[i] = ' ';
                    continue;
                }
            }

            return new string(chars);
        }

        var scan = StripQuotedStrings(yaml);
        if (scan.Contains("<<:", StringComparison.Ordinal) ||
            System.Text.RegularExpressions.Regex.IsMatch(scan, "(^|\\s)&[A-Za-z0-9_-]+", System.Text.RegularExpressions.RegexOptions.Multiline) ||
            System.Text.RegularExpressions.Regex.IsMatch(scan, "(^|\\s)\\*[A-Za-z0-9_-]+", System.Text.RegularExpressions.RegexOptions.Multiline))
        {
            throw new InvalidOperationException("YAML anchors/aliases/merge keys are not supported.");
        }

        var yamlStream = new YamlStream();
        try
        {
            using var reader = new StringReader(yaml);
            yamlStream.Load(reader);
        }
        catch (YamlException ex)
        {
            throw new InvalidOperationException($"Invalid YAML: {ex.Message}", ex);
        }

        if (yamlStream.Documents.Count == 0)
        {
            throw new InvalidOperationException("YAML contains no document.");
        }

        if (yamlStream.Documents.Count != 1)
        {
            throw new InvalidOperationException("YAML must contain exactly one document.");
        }

        if (yamlStream.Documents[0].RootNode is not YamlMappingNode root)
        {
            throw new InvalidOperationException("Expected YAML root to be a mapping (object).");
        }

        var warnings = new List<string>();

		var mapName = GetScalarValue(root, "mapName")
			?? GetScalarValue(root, "map")
			?? GetScalarValue(root, "title")
			?? GetScalarValue(root, "name");

        if (!string.IsNullOrWhiteSpace(mapName) && mapName.Length > MaxNameChars)
        {
            mapName = mapName[..MaxNameChars];
            warnings.Add($"Map name was truncated to {MaxNameChars} characters.");
        }

        var setsNode = GetValue(root, "sets") ?? GetValue(root, "groups");
        if (setsNode is null)
        {
            throw new InvalidOperationException("Expected a root key 'sets' (or 'groups').");
        }

        var sets = new List<CountrySet>();
        var assignments = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

        var totalCountries = 0;

        void addSet(string name, string? color, IEnumerable<string> countries)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                warnings.Add("Skipped a set with missing name.");
                return;
            }

            if (sets.Count >= MaxSets)
            {
                throw new InvalidOperationException($"Too many sets. Limit is {MaxSets}.");
            }

            var safeName = name.Trim();
            if (safeName.Length > MaxNameChars)
            {
                safeName = safeName[..MaxNameChars];
                warnings.Add($"Truncated a set name to {MaxNameChars} characters.");
            }

            string safeColor = string.IsNullOrWhiteSpace(color) ? "#808080" : color.Trim();
            if (safeColor.Length > MaxColorChars)
            {
                safeColor = safeColor[..MaxColorChars];
                warnings.Add($"Truncated a set color to {MaxColorChars} characters.");
            }

            // Prevent style injection if this value is later used in inline styles.
            // (We still allow named colors and rgb()/hsl() forms.)
            safeColor = safeColor.Replace(";", "", StringComparison.Ordinal)
                                 .Replace("\r", "", StringComparison.Ordinal)
                                 .Replace("\n", "", StringComparison.Ordinal)
                                 .Trim();

            var set = new CountrySet(Guid.NewGuid(), safeName, safeColor);
            sets.Add(set);

            foreach (var country in countries)
            {
                if (totalCountries >= MaxCountriesTotal)
                {
                    throw new InvalidOperationException($"Too many countries. Limit is {MaxCountriesTotal}.");
                }

                var normalized = NormalizeCountryId(country);
                if (normalized is null)
                {
                    warnings.Add($"Skipped invalid country id '{country}'.");
                    continue;
                }

                // Last assignment wins.
                assignments[normalized] = set.Id;
                totalCountries++;
            }
        }

        switch (setsNode)
        {
            case YamlSequenceNode seq:
                foreach (var item in seq.Children)
                {
                    if (item is not YamlMappingNode setMap)
                    {
                        warnings.Add("Skipped a non-object item in sets.");
                        continue;
                    }

                    var name = GetScalarValue(setMap, "name") ?? GetScalarValue(setMap, "group");
                    var color = GetScalarValue(setMap, "color") ?? GetScalarValue(setMap, "colour");
                    var countries = ReadCountryList(GetValue(setMap, "countries") ?? GetValue(setMap, "country"));

                    addSet(name ?? "", color, countries);
                }
                break;

            case YamlMappingNode map:
                foreach (var kvp in map.Children)
                {
                    var name = (kvp.Key as YamlScalarNode)?.Value ?? "";

                    string? color = null;
                    IEnumerable<string> countries = Array.Empty<string>();

                    if (kvp.Value is YamlMappingNode setMap)
                    {
                        color = GetScalarValue(setMap, "color") ?? GetScalarValue(setMap, "colour");
                        countries = ReadCountryList(GetValue(setMap, "countries") ?? GetValue(setMap, "country"));
                    }
                    else
                    {
                        // Allow shorthand: SetName: [US, CA]
                        countries = ReadCountryList(kvp.Value);
                    }

                    addSet(name, color, countries);
                }
                break;

            default:
                throw new InvalidOperationException("Expected 'sets' to be either a list or a mapping.");
        }

        return new YamlImportResult(mapName, sets, assignments, warnings);
    }

    private static YamlNode? GetValue(YamlMappingNode map, string key)
    {
        foreach (var kvp in map.Children)
        {
            if (kvp.Key is YamlScalarNode ks && string.Equals(ks.Value, key, StringComparison.OrdinalIgnoreCase))
            {
                return kvp.Value;
            }
        }
        return null;
    }

    private static string? GetScalarValue(YamlMappingNode map, string key)
    {
        var node = GetValue(map, key);
        return (node as YamlScalarNode)?.Value;
    }

    private static IEnumerable<string> ReadCountryList(YamlNode? node)
    {
        if (node is null)
        {
            return Array.Empty<string>();
        }

        if (node is YamlSequenceNode seq)
        {
            return seq.Children
                .OfType<YamlScalarNode>()
                .Select(s => s.Value ?? "")
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToArray();
        }

        if (node is YamlScalarNode scalar)
        {
            var raw = scalar.Value ?? "";
            if (string.IsNullOrWhiteSpace(raw))
            {
                return Array.Empty<string>();
            }

            // Allow comma-separated scalar.
            return raw
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToArray();
        }

        return Array.Empty<string>();
    }

    private string? NormalizeCountryId(string? countryId)
    {
        if (string.IsNullOrWhiteSpace(countryId))
        {
            return null;
        }

        var trimmed = countryId.Trim();

        // Fast-path: if it's already an id used by this SVG, accept it.
        if (_countryCatalog is not null)
        {
            var maybeId = CountryIdResolver.ResolveToIso2OrIso3(trimmed);
            if (maybeId is not null && _countryCatalog.ContainsId(maybeId))
            {
                return maybeId;
            }

            // Try SVG title-based lookup (works even if culture tables are trimmed).
            if (_countryCatalog.TryResolveIdFromName(trimmed, out var byName) && _countryCatalog.ContainsId(byName))
            {
                return byName;
            }
        }

        // Fallback: RegionInfo-based lookup.
        var resolved = CountryIdResolver.ResolveToIso2OrIso3(trimmed);

        // If we have a catalog, do not silently accept IDs that aren't present in the SVG.
        if (_countryCatalog is not null)
        {
            return resolved is not null && _countryCatalog.ContainsId(resolved)
                ? resolved
                : null;
        }

        // Otherwise, accept if it looks like a plausible id.
        return resolved;
    }
}
