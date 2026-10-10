package filter

// addMemoFacetFields keeps media and partition filtering in SQL, before paging.
// Each expression is correlated with the already-authorized memo row.
func addMemoFacetFields(fields map[string]Field) {
	for name, mimePrefix := range map[string]string{"has_attachment": "", "has_image": "image/", "has_audio": "audio/"} {
		predicate := "EXISTS (SELECT 1 FROM attachment WHERE attachment.memo_id = %[1]s"
		if mimePrefix != "" {
			predicate += " AND attachment.type LIKE '" + mimePrefix + "%%'"
		}
		predicate += ")"
		fields[name] = Field{
			Name: name, Kind: FieldKindBoolColumn, Type: FieldTypeBool,
			Column:               Column{Table: "memo", Name: "id"},
			Expressions:          map[DialectName]string{DialectSQLite: predicate, DialectMySQL: predicate, DialectPostgres: predicate},
			AllowedComparisonOps: map[ComparisonOperator]bool{CompareEq: true, CompareNeq: true},
		}
	}
	partitionValue := func(extract string) string {
		return "COALESCE((SELECT " + extract + " FROM journal_document p WHERE p.owner_id = memo.creator_id AND p.kind = 'partition-mapping' AND p.document_key = %[1]s), '')"
	}
	fields["journal_partition"] = Field{
		Name: "journal_partition", Kind: FieldKindScalar, Type: FieldTypeString,
		Column: Column{Table: "memo", Name: "uid"},
		Expressions: map[DialectName]string{
			DialectSQLite:   partitionValue("json_extract(p.payload, '$.partitionId')"),
			DialectMySQL:    partitionValue("JSON_UNQUOTE(JSON_EXTRACT(p.payload, '$.partitionId'))"),
			DialectPostgres: partitionValue("p.payload::jsonb->>'partitionId'"),
		},
		AllowedComparisonOps: map[ComparisonOperator]bool{CompareEq: true, CompareNeq: true},
	}
}
