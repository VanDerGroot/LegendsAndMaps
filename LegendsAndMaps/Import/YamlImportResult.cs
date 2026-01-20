using LegendsAndMaps.State;

namespace LegendsAndMaps.Import;

public sealed record YamlImportResult(
	string? MapName,
    IReadOnlyList<CountrySet> Sets,
    IReadOnlyDictionary<string, Guid> CountryAssignments,
    IReadOnlyList<string> Warnings
);
